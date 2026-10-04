-- Apply after database/sales-returns-accounting-migration.sql.
-- Keeps purchase costs private, snapshots them on each order, and reports product margins.

create table if not exists public.product_costs (
  product_id bigint primary key references public.products(id) on delete cascade,
  unit_cost numeric(12,2) check (unit_cost is null or unit_cost >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.product_costs enable row level security;
revoke all on public.product_costs from public, anon, authenticated;
grant select, insert, update on public.product_costs to authenticated;

drop policy if exists product_costs_admin_select on public.product_costs;
create policy product_costs_admin_select on public.product_costs
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists product_costs_admin_insert on public.product_costs;
create policy product_costs_admin_insert on public.product_costs
  for insert to authenticated
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists product_costs_admin_update on public.product_costs;
create policy product_costs_admin_update on public.product_costs
  for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

insert into public.product_costs (product_id)
select products.id from public.products
on conflict (product_id) do nothing;

create or replace function private.ensure_product_cost_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.product_costs (product_id) values (new.id)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

revoke all on function private.ensure_product_cost_row() from public, anon, authenticated;
drop trigger if exists products_ensure_cost_row on public.products;
create trigger products_ensure_cost_row
after insert on public.products
for each row execute function private.ensure_product_cost_row();

create or replace function private.touch_product_cost_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function private.touch_product_cost_row() from public, anon, authenticated;
drop trigger if exists product_costs_touch_updated_at on public.product_costs;
create trigger product_costs_touch_updated_at
before update on public.product_costs
for each row execute function private.touch_product_cost_row();

-- Ignore any cost sent by a browser and attach only the value held in the
-- admin-only table. A later cost change will not rewrite past order snapshots.
create or replace function private.snapshot_product_costs_on_order_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  select coalesce(jsonb_agg(
    (line.value - 'unit_cost') || jsonb_build_object('unit_cost', costs.unit_cost)
    order by line.ordinality
  ), '[]'::jsonb)
  into new.items
  from jsonb_array_elements(new.items) with ordinality as line(value, ordinality)
  left join public.product_costs as costs
    on costs.product_id = (line.value ->> 'product_id')::bigint;
  return new;
end;
$$;

revoke all on function private.snapshot_product_costs_on_order_insert() from public, anon, authenticated;
drop trigger if exists orders_snapshot_unit_cost_before_insert on public.orders;
create trigger orders_snapshot_unit_cost_before_insert
before insert on public.orders
for each row execute function private.snapshot_product_costs_on_order_insert();

-- The stored order item snapshots contain unit_cost for profit calculation.
-- Remove it from both fresh checkout responses and idempotent replay responses.
create or replace function public.create_order_secure(
  p_ip_hash text,
  p_idempotency_key uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_governorate text,
  p_city text,
  p_address text,
  p_building text,
  p_floor text,
  p_apartment text,
  p_notes text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_idempotency_key::text, 0)
    );

    select jsonb_build_object(
      'order_id', orders.id,
      'items', coalesce((
        select jsonb_agg(line.value - 'unit_cost' order by line.ordinality)
        from jsonb_array_elements(orders.items) with ordinality as line(value, ordinality)
      ), '[]'::jsonb),
      'subtotal', orders.subtotal,
      'shipping', orders.shipping,
      'total', orders.total
    ) into v_result
    from public.orders
    where idempotency_key = p_idempotency_key;

    if v_result is not null then return v_result; end if;
  end if;

  v_result := private.create_order_secure_impl(
    p_ip_hash, p_idempotency_key, p_first_name, p_last_name, p_phone,
    p_governorate, p_city, p_address, p_building, p_floor, p_apartment,
    p_notes, p_items
  );

  if jsonb_typeof(v_result -> 'items') = 'array' then
    v_result := jsonb_set(v_result, '{items}', coalesce((
      select jsonb_agg(line.value - 'unit_cost' order by line.ordinality)
      from jsonb_array_elements(v_result -> 'items') with ordinality as line(value, ordinality)
    ), '[]'::jsonb));
  end if;

  return v_result;
end;
$$;

revoke all on function private.create_order_secure_impl(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) to service_role;

create or replace function public.get_product_profit_summary()
returns table (
  product_id bigint,
  product_name text,
  selling_price numeric,
  purchase_cost numeric,
  unit_profit numeric,
  units_sold bigint,
  units_returned bigint,
  net_sales numeric,
  cost_of_goods numeric,
  gross_profit numeric,
  estimated_cost boolean,
  missing_cost boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with delivered_order_lines as (
    select
      orders.id as order_id,
      (line.value ->> 'product_id')::bigint as product_id,
      coalesce(max(line.value ->> 'name'), max(products.name), 'منتج') as product_name,
      sum((line.value ->> 'quantity')::integer)::bigint as units_sold,
      sum(coalesce(nullif(line.value ->> 'unit_price', '')::numeric,
                   nullif(line.value ->> 'price', '')::numeric, 0)
          * (line.value ->> 'quantity')::integer) as sales_amount,
      sum(coalesce(nullif(line.value ->> 'unit_cost', '')::numeric, costs.unit_cost)
          * (line.value ->> 'quantity')::integer) as cost_amount,
      bool_or(nullif(line.value ->> 'unit_cost', '') is null and costs.unit_cost is not null) as estimated_cost,
      bool_or(coalesce(nullif(line.value ->> 'unit_cost', '')::numeric, costs.unit_cost) is null) as missing_cost
    from public.orders
    cross join lateral jsonb_array_elements(orders.items) as line(value)
    left join public.products on products.id = (line.value ->> 'product_id')::bigint
    left join public.product_costs as costs on costs.product_id = (line.value ->> 'product_id')::bigint
    where orders.status = 'delivered'
    group by orders.id, (line.value ->> 'product_id')::bigint, costs.unit_cost
  ), returned_order_lines as (
    select
      return_item.order_id,
      return_item.product_id,
      sum(return_item.quantity)::bigint as units_returned,
      sum(return_item.unit_price * return_item.quantity) as refund_amount,
      sum(coalesce(nullif(original_line.value ->> 'unit_cost', '')::numeric, costs.unit_cost)
          * return_item.quantity) filter (where return_item.disposition = 'restock') as restocked_cost,
      bool_or(coalesce(nullif(original_line.value ->> 'unit_cost', '')::numeric, costs.unit_cost) is null)
        filter (where return_item.disposition = 'restock') as missing_restock_cost,
      bool_or(nullif(original_line.value ->> 'unit_cost', '') is null and costs.unit_cost is not null)
        filter (where return_item.disposition = 'restock') as estimated_restock_cost
    from public.order_return_items as return_item
    join public.orders on orders.id = return_item.order_id
    join lateral (
      select line.value
      from jsonb_array_elements(orders.items) as line(value)
      where (line.value ->> 'product_id')::bigint = return_item.product_id
      limit 1
    ) as original_line on true
    left join public.product_costs as costs on costs.product_id = return_item.product_id
    group by return_item.order_id, return_item.product_id, costs.unit_cost
  ), product_sales as (
    select
      delivered.product_id,
      max(delivered.product_name) as product_name,
      sum(delivered.units_sold)::bigint as units_sold,
      coalesce(sum(returned.units_returned), 0)::bigint as units_returned,
      sum(delivered.sales_amount) - coalesce(sum(returned.refund_amount), 0) as net_sales,
      sum(delivered.cost_amount) - coalesce(sum(returned.restocked_cost), 0) as cost_of_goods,
      coalesce(bool_or(delivered.estimated_cost), false)
        or coalesce(bool_or(returned.estimated_restock_cost), false) as estimated_cost,
      coalesce(bool_or(delivered.missing_cost), false)
        or coalesce(bool_or(returned.missing_restock_cost), false) as missing_cost
    from delivered_order_lines as delivered
    left join returned_order_lines as returned
      on returned.order_id = delivered.order_id
      and returned.product_id = delivered.product_id
    group by delivered.product_id
  ), all_products as (
    select products.id as product_id, products.name as product_name,
      products.price as selling_price, costs.unit_cost as purchase_cost
    from public.products
    left join public.product_costs as costs on costs.product_id = products.id
    union all
    select sales.product_id, sales.product_name, null::numeric, null::numeric
    from product_sales as sales
    where not exists (select 1 from public.products where id = sales.product_id)
  )
  select
    all_products.product_id,
    all_products.product_name,
    all_products.selling_price,
    all_products.purchase_cost,
    case when all_products.selling_price is null or all_products.purchase_cost is null then null
         else all_products.selling_price - all_products.purchase_cost end as unit_profit,
    coalesce(sales.units_sold, 0),
    coalesce(sales.units_returned, 0),
    case when coalesce(sales.missing_cost, false) then null else coalesce(sales.net_sales, 0) end,
    case when coalesce(sales.missing_cost, false) then null else coalesce(sales.cost_of_goods, 0) end,
    case when coalesce(sales.missing_cost, false) then null
         else coalesce(sales.net_sales, 0) - coalesce(sales.cost_of_goods, 0) end,
    coalesce(sales.estimated_cost, false),
    coalesce(sales.missing_cost, false)
  from all_products
  left join product_sales as sales on sales.product_id = all_products.product_id
  where (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  order by all_products.product_name, all_products.product_id;
$$;

revoke all on function public.get_product_profit_summary() from public, anon;
grant execute on function public.get_product_profit_summary() to authenticated;
