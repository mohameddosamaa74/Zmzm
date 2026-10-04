-- Run after database/orders-migration.sql or database/supabase-schema.sql.
-- The browser must not receive direct INSERT access to public.orders.

alter table public.orders
  add column if not exists idempotency_key uuid;

create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key);

revoke insert on public.orders from public, anon, authenticated;
drop policy if exists "orders_visitor_insert" on public.orders;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.order_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0)
);
create index if not exists order_rate_limits_window_idx
  on private.order_rate_limits (window_started_at);
revoke all on table private.order_rate_limits from public, anon, authenticated;

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
  v_now timestamptz := now();
  v_request_count integer;
  v_item_count integer;
  v_found_products integer;
  v_distinct_products integer;
  v_subtotal numeric;
  v_shipping numeric;
  v_total numeric;
  v_order_items jsonb;
  v_order_id uuid;
  v_existing_order jsonb;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'ORDER_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null then
    raise exception 'ORDER_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'order_id', id,
    'items', items,
    'subtotal', subtotal,
    'shipping', shipping,
    'total', total
  )
  into v_existing_order
  from public.orders
  where idempotency_key = p_idempotency_key;
  if v_existing_order is not null then
    return v_existing_order;
  end if;

  insert into private.order_rate_limits as current_limit (ip_hash, window_started_at, request_count)
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

  if v_request_count > 20 then
    raise exception 'ORDER_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if v_request_count = 1 then
    delete from private.order_rate_limits
    where window_started_at < v_now - interval '24 hours';
  end if;

  if char_length(btrim(coalesce(p_first_name, ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_last_name, ''))) not between 1 and 80
    or coalesce(p_phone, '') !~ '^01[0125][0-9]{8}$'
    or char_length(btrim(coalesce(p_city, ''))) not between 1 and 100
    or char_length(btrim(coalesce(p_address, ''))) not between 1 and 250
    or char_length(btrim(coalesce(p_building, ''))) not between 1 and 50
    or char_length(btrim(coalesce(p_floor, ''))) not between 1 and 30
    or char_length(btrim(coalesce(p_apartment, ''))) not between 1 and 30
    or char_length(coalesce(p_notes, '')) > 500
    or p_governorate is null
    or p_governorate not in (
      'القاهرة', 'الإسكندرية', 'بورسعيد', 'السويس', 'دمياط', 'الدقهلية',
      'الشرقية', 'القليوبية', 'كفر الشيخ', 'الغربية', 'المنوفية', 'البحيرة',
      'الإسماعيلية', 'الجيزة', 'بني سويف', 'الفيوم', 'المنيا', 'أسيوط',
      'سوهاج', 'قنا', 'الأقصر', 'أسوان', 'البحر الأحمر', 'الوادي الجديد',
      'مطروح', 'شمال سيناء', 'جنوب سيناء'
    )
  then
    raise exception 'ORDER_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'ORDER_INVALID_ITEMS' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) not between 1 and 20 then
    raise exception 'ORDER_INVALID_ITEMS' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) as entries(value)
    where jsonb_typeof(entries.value) <> 'object'
      or jsonb_typeof(entries.value -> 'product_id') <> 'number'
      or jsonb_typeof(entries.value -> 'quantity') <> 'number'
      or coalesce(entries.value ->> 'product_id', '') !~ '^[1-9][0-9]{0,17}$'
      or coalesce(entries.value ->> 'quantity', '') !~ '^[1-9][0-9]?$'
  ) then
    raise exception 'ORDER_INVALID_ITEMS' using errcode = 'P0001';
  end if;

  with requested as (
    select
      (entry.value ->> 'product_id')::bigint as product_id,
      (entry.value ->> 'quantity')::integer as quantity,
      entry.ordinality
    from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
  )
  select
    count(*)::integer,
    count(product.id)::integer,
    count(distinct requested.product_id)::integer,
    coalesce(sum(product.price * requested.quantity), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product.id,
      'name', product.name,
      'unit_price', product.price,
      'quantity', requested.quantity,
      'image', product.image
    ) order by requested.ordinality), '[]'::jsonb)
  into v_item_count, v_found_products, v_distinct_products, v_subtotal, v_order_items
  from requested
  left join public.products as product on product.id = requested.product_id;

  if v_item_count not between 1 and 20
    or v_found_products <> v_item_count
    or v_distinct_products <> v_item_count
    or v_subtotal < 0
  then
    raise exception 'ORDER_INVALID_ITEMS' using errcode = 'P0001';
  end if;

  if v_subtotal >= 500 then
    v_shipping := 0;
  elsif p_governorate = 'السويس' then
    v_shipping := 40;
  elsif p_governorate in ('القاهرة', 'الجيزة', 'الإسماعيلية', 'بورسعيد') then
    v_shipping := 65;
  else
    v_shipping := 85;
  end if;
  v_total := v_subtotal + v_shipping;

  insert into public.orders (
    first_name, last_name, phone, governorate, city, address,
    building, floor, apartment, notes, items, subtotal, shipping, total,
    status, idempotency_key
  ) values (
    btrim(p_first_name), btrim(p_last_name), p_phone, p_governorate,
    btrim(p_city), btrim(p_address), btrim(p_building), btrim(p_floor),
    btrim(p_apartment), nullif(btrim(coalesce(p_notes, '')), ''),
    v_order_items, v_subtotal, v_shipping, v_total, 'pending', p_idempotency_key
  )
  on conflict (idempotency_key) do nothing
  returning id into v_order_id;

  if v_order_id is null then
    select jsonb_build_object(
      'order_id', id,
      'items', items,
      'subtotal', subtotal,
      'shipping', shipping,
      'total', total
    )
    into v_existing_order
    from public.orders
    where idempotency_key = p_idempotency_key;
    return v_existing_order;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'items', v_order_items,
    'subtotal', v_subtotal,
    'shipping', v_shipping,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) to service_role;
