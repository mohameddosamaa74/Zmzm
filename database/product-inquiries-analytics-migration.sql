-- Apply after the inventory, order returns, delivered-order accounting, and
-- product-cost migrations. Public visitors may submit a tightly validated
-- inquiry. Only authenticated admins can read or update inquiries and analytics.

create table if not exists public.product_inquiries (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (char_length(product_name) between 1 and 160),
  description text check (description is null or char_length(description) <= 1200),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'answered', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_inquiries_created_at_idx
  on public.product_inquiries (created_at desc);
create index if not exists product_inquiries_status_created_at_idx
  on public.product_inquiries (status, created_at desc);

alter table public.product_inquiries enable row level security;
revoke all on public.product_inquiries from public, anon, authenticated;
grant select, update on public.product_inquiries to authenticated;

drop policy if exists product_inquiries_admin_select on public.product_inquiries;
create policy product_inquiries_admin_select
  on public.product_inquiries for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists product_inquiries_admin_update on public.product_inquiries;
create policy product_inquiries_admin_update
  on public.product_inquiries for update to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and status in ('new', 'reviewing', 'answered', 'closed')
  );

create or replace function private.normalize_product_inquiry()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.product_name := btrim(coalesce(new.product_name, ''));
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.status := 'new';
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.normalize_product_inquiry() from public, anon, authenticated;
drop trigger if exists product_inquiries_normalize_insert on public.product_inquiries;
create trigger product_inquiries_normalize_insert
  before insert on public.product_inquiries
  for each row execute function private.normalize_product_inquiry();

create or replace function private.touch_product_inquiry_updated_at()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_product_inquiry_updated_at() from public, anon, authenticated;
drop trigger if exists product_inquiries_touch_updated_at on public.product_inquiries;
create trigger product_inquiries_touch_updated_at
  before update on public.product_inquiries
  for each row execute function private.touch_product_inquiry_updated_at();

create table if not exists private.product_inquiry_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);
create index if not exists product_inquiry_rate_limits_window_idx
  on private.product_inquiry_rate_limits (window_started_at);
revoke all on table private.product_inquiry_rate_limits from public, anon, authenticated, service_role;

create or replace function public.submit_product_inquiry(
  p_ip_hash text,
  p_product_name text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_now timestamptz := now();
  v_request_count integer;
  v_inquiry_id uuid;
  v_product_name text := btrim(coalesce(p_product_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
    or char_length(v_product_name) not between 1 and 160
    or char_length(coalesce(v_description, '')) > 1200 then
    raise exception 'INQUIRY_INVALID' using errcode = 'P0001';
  end if;

  insert into private.product_inquiry_rate_limits as current_limit (ip_hash, window_started_at, request_count)
  values (p_ip_hash, v_now, 1)
  on conflict (ip_hash) do update
  set window_started_at = case
        when current_limit.window_started_at <= v_now - interval '15 minutes' then v_now
        else current_limit.window_started_at
      end,
      request_count = case
        when current_limit.window_started_at <= v_now - interval '15 minutes' then 1
        else current_limit.request_count + 1
      end
  returning request_count into v_request_count;

  if v_request_count > 15 then
    raise exception 'INQUIRY_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if v_request_count = 1 then
    delete from private.product_inquiry_rate_limits
    where window_started_at < v_now - interval '24 hours';
  end if;

  insert into public.product_inquiries (product_name, description)
  values (v_product_name, v_description)
  returning id into v_inquiry_id;
  return v_inquiry_id;
end;
$$;

revoke all on function public.submit_product_inquiry(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_product_inquiry(text, text, text) to service_role;

create index if not exists orders_phone_created_at_idx
  on public.orders (phone, created_at desc);

create or replace function public.get_business_analytics(p_period text default '30d')
returns jsonb
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, private, auth
as $$
declare
  v_now timestamptz := now();
  v_from timestamptz;
  v_period text := coalesce(p_period, '30d');
  v_bucket text;
  v_result jsonb;
begin
  if auth.uid() is null or (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'ANALYTICS_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_period not in ('7d', '30d', '90d', '365d', 'all') then
    raise exception 'ANALYTICS_INVALID_PERIOD' using errcode = '22023';
  end if;

  v_from := case v_period
    when '7d' then v_now - interval '7 days'
    when '30d' then v_now - interval '30 days'
    when '90d' then v_now - interval '90 days'
    when '365d' then v_now - interval '365 days'
    else timestamptz '1900-01-01 00:00:00+00'
  end;
  v_bucket := case v_period
    when '7d' then 'day'
    when '30d' then 'day'
    when '90d' then 'week'
    else 'month'
  end;

  with settings as (
    select v_from as from_at, v_now as to_at, v_bucket as bucket
  ), period_orders as materialized (
    select orders.*
    from public.orders as orders
    cross join settings
    where orders.created_at >= settings.from_at
      and orders.created_at <= settings.to_at
  ), return_totals as (
    select order_returns.order_id,
      sum(order_returns.refund_amount)::numeric as refund_amount,
      count(*)::bigint as return_count
    from public.order_returns as order_returns
    join period_orders on period_orders.id = order_returns.order_id
    group by order_returns.order_id
  ), return_lines as (
    select return_item.order_id,
      return_item.product_id,
      sum(return_item.quantity)::bigint as units_returned,
      sum(return_item.unit_price * return_item.quantity)::numeric as refund_amount,
      sum(coalesce(nullif(original_line.value ->> 'unit_cost', '')::numeric, product_costs.unit_cost)
          * return_item.quantity) filter (where return_item.disposition = 'restock') as restocked_cost,
      bool_or(coalesce(nullif(original_line.value ->> 'unit_cost', '')::numeric, product_costs.unit_cost) is null)
        filter (where return_item.disposition = 'restock') as missing_restock_cost
    from public.order_return_items as return_item
    join period_orders on period_orders.id = return_item.order_id
    join lateral (
      select line.value
      from jsonb_array_elements(period_orders.items) as line(value)
      where (line.value ->> 'product_id')::bigint = return_item.product_id
      limit 1
    ) as original_line on true
    left join public.product_costs as product_costs
      on product_costs.product_id = return_item.product_id
    group by return_item.order_id, return_item.product_id, product_costs.unit_cost
  ), delivered_lines as (
    select
      (line.value ->> 'product_id')::bigint as product_id,
      coalesce(max(nullif(line.value ->> 'name', '')), max(products.name), 'منتج') as product_name,
      coalesce(max(products.category), 'other') as category,
      sum((line.value ->> 'quantity')::integer)::bigint as units_sold,
      sum(coalesce(nullif(line.value ->> 'unit_price', '')::numeric,
                   nullif(line.value ->> 'price', '')::numeric, 0)
          * (line.value ->> 'quantity')::integer)::numeric as gross_sales,
      sum(coalesce(nullif(line.value ->> 'unit_cost', '')::numeric, product_costs.unit_cost)
          * (line.value ->> 'quantity')::integer)::numeric as sold_cost,
      bool_or(coalesce(nullif(line.value ->> 'unit_cost', '')::numeric, product_costs.unit_cost) is null) as missing_cost
    from period_orders
    cross join lateral jsonb_array_elements(period_orders.items) as line(value)
    left join public.products as products
      on products.id = (line.value ->> 'product_id')::bigint
    left join public.product_costs as product_costs
      on product_costs.product_id = (line.value ->> 'product_id')::bigint
    where period_orders.status = 'delivered'
    group by (line.value ->> 'product_id')::bigint
  ), product_stats as (
    select
      delivered_lines.product_id,
      delivered_lines.product_name,
      delivered_lines.category,
      delivered_lines.units_sold,
      coalesce(sum(return_lines.units_returned), 0)::bigint as units_returned,
      delivered_lines.gross_sales - coalesce(sum(return_lines.refund_amount), 0) as net_sales,
      case when delivered_lines.missing_cost
          or coalesce(bool_or(return_lines.missing_restock_cost), false)
        then null
        else coalesce(delivered_lines.sold_cost, 0) - coalesce(sum(return_lines.restocked_cost), 0)
      end as cost_of_goods,
      case when delivered_lines.missing_cost
          or coalesce(bool_or(return_lines.missing_restock_cost), false)
        then null
        else delivered_lines.gross_sales - coalesce(sum(return_lines.refund_amount), 0)
          - coalesce(delivered_lines.sold_cost, 0) + coalesce(sum(return_lines.restocked_cost), 0)
      end as gross_profit
    from delivered_lines
    left join return_lines on return_lines.product_id = delivered_lines.product_id
    group by delivered_lines.product_id, delivered_lines.product_name, delivered_lines.category,
      delivered_lines.units_sold, delivered_lines.gross_sales, delivered_lines.sold_cost,
      delivered_lines.missing_cost
  ), customer_stats as (
    select
      period_orders.phone,
      max(btrim(concat_ws(' ', period_orders.first_name, period_orders.last_name))) as customer_name,
      count(*)::bigint as orders_count,
      count(*) filter (where period_orders.status = 'delivered')::bigint as delivered_orders,
      coalesce(sum(period_orders.subtotal - coalesce(return_totals.refund_amount, 0))
        filter (where period_orders.status = 'delivered'), 0)::numeric as net_sales,
      max(period_orders.created_at) as last_order_at
    from period_orders
    left join return_totals on return_totals.order_id = period_orders.id
    group by period_orders.phone
  ), inquiry_stats as (
    select
      lower(regexp_replace(btrim(product_inquiries.product_name), '[[:space:]]+', ' ', 'g')) as normalized_name,
      max(btrim(product_inquiries.product_name)) as product_name,
      count(*)::bigint as request_count,
      count(*) filter (where product_inquiries.status = 'new')::bigint as new_count,
      max(product_inquiries.created_at) as last_requested_at
    from public.product_inquiries as product_inquiries
    cross join settings
    where product_inquiries.created_at >= settings.from_at
      and product_inquiries.created_at <= settings.to_at
    group by lower(regexp_replace(btrim(product_inquiries.product_name), '[[:space:]]+', ' ', 'g'))
  ), stats as (
    select
      count(*)::bigint as orders_count,
      count(*) filter (where period_orders.status = 'delivered')::bigint as delivered_orders,
      count(*) filter (where period_orders.status in ('pending', 'confirmed', 'processing', 'shipped'))::bigint as open_orders,
      count(*) filter (where period_orders.status = 'cancelled')::bigint as cancelled_orders,
      coalesce(sum(period_orders.subtotal) filter (where period_orders.status = 'delivered'), 0)::numeric as gross_sales,
      coalesce(sum(return_totals.refund_amount) filter (where period_orders.status = 'delivered'), 0)::numeric as sales_returns,
      (select count(*)::bigint from return_totals) as returned_orders,
      count(distinct period_orders.phone)::bigint as customers_count,
      (select count(*)::bigint from customer_stats where customer_stats.orders_count > 1) as repeat_customers
    from period_orders
    left join return_totals on return_totals.order_id = period_orders.id
  ), inquiry_totals as (
    select count(*)::bigint as count,
      count(*) filter (where product_inquiries.status = 'new')::bigint as new_count
    from public.product_inquiries as product_inquiries
    cross join settings
    where product_inquiries.created_at >= settings.from_at
      and product_inquiries.created_at <= settings.to_at
  ), account_totals as (
    select
      coalesce(sum(account_entries.amount) filter (where account_entries.entry_type = 'income'), 0)::numeric as income,
      coalesce(sum(account_entries.amount) filter (where account_entries.entry_type = 'sales_return'), 0)::numeric as sales_returns,
      coalesce(sum(account_entries.amount) filter (where account_entries.entry_type = 'expense'), 0)::numeric as expenses
    from public.account_entries as account_entries
    cross join settings
    where account_entries.entry_date >= settings.from_at::date
      and account_entries.entry_date <= settings.to_at::date
  ), inventory_totals as (
    select
      coalesce(sum(inventory_stock.on_hand - inventory_stock.reserved)
        filter (where inventory_stock.is_initialized), 0)::bigint as available_units,
      coalesce(sum(inventory_stock.reserved) filter (where inventory_stock.is_initialized), 0)::bigint as reserved_units,
      count(*) filter (where inventory_stock.is_initialized
        and inventory_stock.on_hand - inventory_stock.reserved <= inventory_stock.reorder_level)::bigint as low_stock_products,
      count(*) filter (where inventory_stock.is_initialized
        and inventory_stock.on_hand - inventory_stock.reserved <= 0)::bigint as out_of_stock_products
    from public.inventory_stock
  ), trend_rows as (
    select
      date_trunc(settings.bucket, period_orders.created_at) as bucket,
      count(*)::bigint as orders_count,
      count(*) filter (where period_orders.status = 'delivered')::bigint as delivered_orders,
      coalesce(sum(period_orders.subtotal - coalesce(return_totals.refund_amount, 0))
        filter (where period_orders.status = 'delivered'), 0)::numeric as net_sales
    from period_orders
    cross join settings
    left join return_totals on return_totals.order_id = period_orders.id
    group by date_trunc(settings.bucket, period_orders.created_at)
  )
  select jsonb_build_object(
    'period', v_period,
    'summary', jsonb_build_object(
      'orders_count', stats.orders_count,
      'delivered_orders', stats.delivered_orders,
      'open_orders', stats.open_orders,
      'cancelled_orders', stats.cancelled_orders,
      'returned_orders', stats.returned_orders,
      'gross_sales', stats.gross_sales,
      'sales_returns', stats.sales_returns,
      'net_sales', stats.gross_sales - stats.sales_returns,
      'cost_of_goods', profit.cost_of_goods,
      'gross_profit', case when profit.profit_complete
        then stats.gross_sales - stats.sales_returns - profit.cost_of_goods else null end,
      'profit_complete', profit.profit_complete,
      'average_order_value', case when stats.delivered_orders = 0 then 0
        else (stats.gross_sales - stats.sales_returns) / stats.delivered_orders end,
      'customers_count', stats.customers_count,
      'repeat_customers', stats.repeat_customers
    ),
    'accounts', jsonb_build_object(
      'income', account_totals.income,
      'sales_returns', account_totals.sales_returns,
      'expenses', account_totals.expenses,
      'net', account_totals.income - account_totals.sales_returns - account_totals.expenses
    ),
    'inventory', jsonb_build_object(
      'available_units', inventory_totals.available_units,
      'reserved_units', inventory_totals.reserved_units,
      'low_stock_products', inventory_totals.low_stock_products,
      'out_of_stock_products', inventory_totals.out_of_stock_products
    ),
    'inquiries', jsonb_build_object(
      'count', inquiry_totals.count,
      'new_count', inquiry_totals.new_count,
      'top_products', coalesce((
        select jsonb_agg(jsonb_build_object(
          'product_name', inquiry_stats.product_name,
          'request_count', inquiry_stats.request_count,
          'new_count', inquiry_stats.new_count,
          'last_requested_at', inquiry_stats.last_requested_at
        ) order by inquiry_stats.request_count desc, inquiry_stats.last_requested_at desc)
        from (select * from inquiry_stats order by request_count desc, last_requested_at desc limit 10) as inquiry_stats
      ), '[]'::jsonb)
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', case when v_bucket = 'month' then to_char(trend_rows.bucket, 'YYYY-MM')
          else to_char(trend_rows.bucket, 'YYYY-MM-DD') end,
        'orders_count', trend_rows.orders_count,
        'delivered_orders', trend_rows.delivered_orders,
        'net_sales', trend_rows.net_sales
      ) order by trend_rows.bucket)
      from trend_rows
    ), '[]'::jsonb),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', product_stats.product_id,
        'product_name', product_stats.product_name,
        'category', product_stats.category,
        'units_sold', product_stats.units_sold,
        'units_returned', product_stats.units_returned,
        'available_now', product_stats.available_now,
        'net_sales', product_stats.net_sales,
        'cost_of_goods', product_stats.cost_of_goods,
        'gross_profit', product_stats.gross_profit
      ) order by product_stats.net_sales desc, product_stats.units_sold desc)
      from (
        select product_stats.*,
          case when inventory_stock.is_initialized
            then inventory_stock.on_hand - inventory_stock.reserved else null end as available_now
        from product_stats
        left join public.inventory_stock on inventory_stock.product_id = product_stats.product_id
        order by product_stats.net_sales desc, product_stats.units_sold desc
        limit 10
      ) as product_stats
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', category_stats.category,
        'units_sold', category_stats.units_sold,
        'net_sales', category_stats.net_sales,
        'gross_profit', category_stats.gross_profit
      ) order by category_stats.net_sales desc)
      from (
        select category,
          sum(units_sold)::bigint as units_sold,
          sum(net_sales)::numeric as net_sales,
          case when bool_or(gross_profit is null) then null else sum(gross_profit)::numeric end as gross_profit
        from product_stats
        group by category
      ) as category_stats
    ), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'customer_name', customer_stats.customer_name,
        'phone', customer_stats.phone,
        'orders_count', customer_stats.orders_count,
        'delivered_orders', customer_stats.delivered_orders,
        'net_sales', customer_stats.net_sales,
        'last_order_at', customer_stats.last_order_at
      ) order by customer_stats.net_sales desc, customer_stats.orders_count desc)
      from (select * from customer_stats order by net_sales desc, orders_count desc limit 20) as customer_stats
    ), '[]'::jsonb)
  )
  into v_result
  from stats
  cross join inquiry_totals
  cross join account_totals
  cross join inventory_totals
  cross join lateral (
    select coalesce(sum(product_stats.cost_of_goods), 0)::numeric as cost_of_goods,
      coalesce(bool_and(product_stats.gross_profit is not null), true) as profit_complete
    from product_stats
  ) as profit;

  return v_result;
end;
$$;

revoke all on function public.get_business_analytics(text) from public, anon;
grant execute on function public.get_business_analytics(text) to authenticated;
