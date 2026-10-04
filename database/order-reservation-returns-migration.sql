-- Apply after order-security-migration.sql, admin-inventory-accounts-migration.sql,
-- order-inventory-availability-migration.sql, and delivered-orders-accounting-migration.sql.
-- Reserves stock atomically when an order is saved and adds auditable partial/full returns.

-- The public checkout RPC is wrapped with an idempotency-key transaction lock so a
-- simultaneous retry gets the saved order before stock validation runs a second time.
do $$
begin
  if to_regprocedure('public.create_order_secure(text,uuid,text,text,text,text,text,text,text,text,text,text,jsonb)') is not null
    and to_regprocedure('private.create_order_secure_impl(text,uuid,text,text,text,text,text,text,text,text,text,text,jsonb)') is null then
    alter function public.create_order_secure(text,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) set schema private;
    alter function private.create_order_secure(text,uuid,text,text,text,text,text,text,text,text,text,text,jsonb) rename to create_order_secure_impl;
  end if;
end $$;

revoke all on function private.create_order_secure_impl(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

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
  v_existing_order jsonb;
begin
  if p_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_idempotency_key::text, 0)
    );

    select jsonb_build_object(
      'order_id', id,
      'items', items,
      'subtotal', subtotal,
      'shipping', shipping,
      'total', total
    ) into v_existing_order
    from public.orders
    where idempotency_key = p_idempotency_key;

    if v_existing_order is not null then return v_existing_order; end if;
  end if;

  return private.create_order_secure_impl(
    p_ip_hash, p_idempotency_key, p_first_name, p_last_name, p_phone,
    p_governorate, p_city, p_address, p_building, p_floor, p_apartment,
    p_notes, p_items
  );
end;
$$;

revoke all on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_order_secure(
  text, uuid, text, text, text, text, text, text, text, text, text, text, jsonb
) to service_role;

-- Keep the stock check before INSERT, holding the product rows until the order
-- transaction finishes. The AFTER INSERT trigger below makes the reservation.
create or replace function private.validate_order_inventory_availability()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_line record;
  v_stock public.inventory_stock%rowtype;
begin
  if new.status <> 'pending' then return new; end if;

  for v_line in
    select (item.value ->> 'product_id')::bigint as product_id,
      sum((item.value ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(new.items) as item(value)
    group by (item.value ->> 'product_id')::bigint
    order by (item.value ->> 'product_id')::bigint
  loop
    select * into v_stock
    from public.inventory_stock
    where product_id = v_line.product_id
    for update;

    if not found or not v_stock.is_initialized then
      raise exception 'INVENTORY_OPENING_REQUIRED' using errcode = 'P0001';
    end if;
    if v_stock.on_hand - v_stock.reserved < v_line.quantity then
      raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE' using errcode = 'P0001';
    end if;
  end loop;

  return new;
end;
$$;

create or replace function private.reserve_order_inventory_on_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_line record;
  v_stock public.inventory_stock%rowtype;
begin
  if new.status <> 'pending' then return new; end if;

  for v_line in
    select product.id as product_id,
      coalesce(max(item.value ->> 'name'), product.name) as product_name,
      sum((item.value ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(new.items) as item(value)
    join public.products as product
      on product.id = (item.value ->> 'product_id')::bigint
    group by product.id, product.name
    order by product.id
  loop
    select * into v_stock
    from public.inventory_stock
    where product_id = v_line.product_id
    for update;

    if not found or not v_stock.is_initialized
      or v_stock.on_hand - v_stock.reserved < v_line.quantity then
      raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE' using errcode = 'P0001';
    end if;

    update public.inventory_stock
    set reserved = reserved + v_line.quantity, updated_at = now()
    where product_id = v_line.product_id;

    insert into private.order_inventory_reservations (
      order_id, product_id, product_name_snapshot, quantity
    ) values (new.id, v_line.product_id, v_line.product_name, v_line.quantity);

    insert into public.inventory_movements (
      product_id, product_name_snapshot, movement_type, quantity_delta,
      reserved_delta, quantity_before, quantity_after, reserved_before,
      reserved_after, order_id, notes, created_by
    ) values (
      v_line.product_id, v_line.product_name, 'reserved', 0,
      v_line.quantity, v_stock.on_hand, v_stock.on_hand,
      v_stock.reserved, v_stock.reserved + v_line.quantity,
      new.id, 'حجز تلقائي عند حفظ الطلب', auth.uid()
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.reserve_order_inventory_on_insert() from public, anon, authenticated;
drop trigger if exists orders_reserve_inventory_on_insert on public.orders;
create trigger orders_reserve_inventory_on_insert
after insert on public.orders
for each row execute function private.reserve_order_inventory_on_insert();

-- Existing pending orders are reserved oldest-first where stock is available.
-- An order that cannot be fully reserved is left untouched and will still be
-- checked atomically when an admin attempts to confirm it.
do $$
declare
  v_order record;
  v_line record;
  v_stock public.inventory_stock%rowtype;
begin
  for v_order in
    select orders.id, orders.items
    from public.orders as orders
    where orders.status = 'pending'
      and not exists (
        select 1 from private.order_inventory_reservations as reservation
        where reservation.order_id = orders.id
      )
    order by orders.created_at, orders.id
  loop
    begin
      for v_line in
        select product.id as product_id, product.name as product_name,
          sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_order.items) as item(value)
        join public.products as product
          on product.id = (item.value ->> 'product_id')::bigint
        group by product.id, product.name
        order by product.id
      loop
        select * into v_stock from public.inventory_stock
        where product_id = v_line.product_id for update;
        if not found or not v_stock.is_initialized
          or v_stock.on_hand - v_stock.reserved < v_line.quantity then
          raise exception 'SKIP_PENDING_ORDER_RESERVATION' using errcode = 'P0001';
        end if;

        update public.inventory_stock
        set reserved = reserved + v_line.quantity, updated_at = now()
        where product_id = v_line.product_id;
        insert into private.order_inventory_reservations (
          order_id, product_id, product_name_snapshot, quantity
        ) values (v_order.id, v_line.product_id, v_line.product_name, v_line.quantity);
        insert into public.inventory_movements (
          product_id, product_name_snapshot, movement_type, quantity_delta,
          reserved_delta, quantity_before, quantity_after, reserved_before,
          reserved_after, order_id, notes, created_by
        ) values (
          v_line.product_id, v_line.product_name, 'reserved', 0,
          v_line.quantity, v_stock.on_hand, v_stock.on_hand,
          v_stock.reserved, v_stock.reserved + v_line.quantity,
          v_order.id, 'حجز طلب معلّق موجود قبل تحديث المخزون', null
        );
      end loop;
    exception when raise_exception then
      if sqlerrm <> 'SKIP_PENDING_ORDER_RESERVATION' then raise; end if;
    end;
  end loop;
end;
$$;

-- Pending checkout orders already own a reservation. Confirmation verifies it
-- instead of reserving twice; cancellation releases it just like later states.
create or replace function public.sync_order_inventory_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_line record;
  v_reservation record;
  v_stock public.inventory_stock%rowtype;
  v_reserved_count integer;
  v_order_line_count integer;
begin
  if old.status = new.status then return new; end if;

  if not (
    (old.status = 'pending' and new.status in ('confirmed', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('processing', 'shipped', 'cancelled'))
    or (old.status = 'processing' and new.status in ('shipped', 'cancelled'))
    or (old.status = 'shipped' and new.status = 'delivered')
    or (old.status = 'cancelled' and new.status = 'confirmed')
  ) then
    raise exception 'ORDER_STATUS_TRANSITION_INVALID';
  end if;

  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if exists (
      select 1 from jsonb_array_elements(old.items) as item(value)
      left join public.products as product
        on product.id = (item.value ->> 'product_id')::bigint
      where product.id is null
    ) then raise exception 'INVENTORY_ORDER_PRODUCT_NOT_FOUND'; end if;

    select count(*) into v_reserved_count
    from private.order_inventory_reservations where order_id = old.id;
    select count(distinct (item.value ->> 'product_id')::bigint)::integer
    into v_order_line_count
    from jsonb_array_elements(old.items) as item(value);

    if v_reserved_count = v_order_line_count and v_reserved_count > 0 then
      if exists (
        with order_lines as (
          select (item.value ->> 'product_id')::bigint as product_id,
            sum((item.value ->> 'quantity')::integer)::integer as quantity
          from jsonb_array_elements(old.items) as item(value)
          group by (item.value ->> 'product_id')::bigint
        )
        select 1 from order_lines
        left join private.order_inventory_reservations as reservation
          on reservation.order_id = old.id and reservation.product_id = order_lines.product_id
        where reservation.quantity is distinct from order_lines.quantity
      ) then raise exception 'INVENTORY_RESERVATION_INVALID'; end if;
    elsif v_reserved_count = 0 then
      -- Supports old pending orders that could not be reserved during migration,
      -- and orders being reconfirmed after cancellation.
      for v_line in
        select product.id as product_id, product.name as product_name,
          sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(old.items) as item(value)
        join public.products as product
          on product.id = (item.value ->> 'product_id')::bigint
        group by product.id, product.name
        order by product.id
      loop
        select * into v_stock from public.inventory_stock
        where product_id = v_line.product_id for update;
        if not found or not v_stock.is_initialized then raise exception 'INVENTORY_OPENING_REQUIRED'; end if;
        if v_stock.on_hand - v_stock.reserved < v_line.quantity then
          raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE';
        end if;

        update public.inventory_stock
        set reserved = reserved + v_line.quantity, updated_at = now()
        where product_id = v_line.product_id;
        insert into private.order_inventory_reservations (
          order_id, product_id, product_name_snapshot, quantity
        ) values (new.id, v_line.product_id, v_line.product_name, v_line.quantity);
        insert into public.inventory_movements (
          product_id, product_name_snapshot, movement_type, quantity_delta,
          reserved_delta, quantity_before, quantity_after, reserved_before,
          reserved_after, order_id, notes, created_by
        ) values (
          v_line.product_id, v_line.product_name, 'reserved', 0,
          v_line.quantity, v_stock.on_hand, v_stock.on_hand,
          v_stock.reserved, v_stock.reserved + v_line.quantity,
          new.id, 'حجز تلقائي عند تأكيد الطلب', auth.uid()
        );
      end loop;
    else
      raise exception 'INVENTORY_RESERVATION_INVALID';
    end if;
  elsif new.status = 'cancelled' and old.status in ('pending', 'confirmed', 'processing') then
    for v_reservation in
      select * from private.order_inventory_reservations
      where order_id = old.id order by product_id
    loop
      select * into v_stock from public.inventory_stock
      where product_id = v_reservation.product_id for update;
      if not found or v_stock.reserved < v_reservation.quantity then
        raise exception 'INVENTORY_RESERVATION_INVALID';
      end if;

      update public.inventory_stock
      set reserved = reserved - v_reservation.quantity, updated_at = now()
      where product_id = v_reservation.product_id;
      insert into public.inventory_movements (
        product_id, product_name_snapshot, movement_type, quantity_delta,
        reserved_delta, quantity_before, quantity_after, reserved_before,
        reserved_after, order_id, notes, created_by
      ) values (
        v_reservation.product_id, v_reservation.product_name_snapshot, 'released', 0,
        -v_reservation.quantity, v_stock.on_hand, v_stock.on_hand,
        v_stock.reserved, v_stock.reserved - v_reservation.quantity,
        old.id, 'تحرير الحجز بعد إلغاء الطلب', auth.uid()
      );
    end loop;
    delete from private.order_inventory_reservations where order_id = old.id;
  elsif new.status = 'shipped' and old.status in ('confirmed', 'processing') then
    select count(*) into v_reserved_count
    from private.order_inventory_reservations where order_id = old.id;
    select count(distinct (item.value ->> 'product_id')::bigint)::integer
    into v_order_line_count
    from jsonb_array_elements(old.items) as item(value);

    if v_reserved_count = v_order_line_count and v_reserved_count > 0 then
      for v_reservation in
        select * from private.order_inventory_reservations
        where order_id = old.id order by product_id
      loop
        select * into v_stock from public.inventory_stock
        where product_id = v_reservation.product_id for update;
        if not found or v_stock.on_hand < v_reservation.quantity
          or v_stock.reserved < v_reservation.quantity then
          raise exception 'INVENTORY_RESERVATION_INVALID';
        end if;
        update public.inventory_stock
        set on_hand = on_hand - v_reservation.quantity,
            reserved = reserved - v_reservation.quantity,
            updated_at = now()
        where product_id = v_reservation.product_id;
        insert into public.inventory_movements (
          product_id, product_name_snapshot, movement_type, quantity_delta,
          reserved_delta, quantity_before, quantity_after, reserved_before,
          reserved_after, order_id, notes, created_by
        ) values (
          v_reservation.product_id, v_reservation.product_name_snapshot, 'shipped',
          -v_reservation.quantity, -v_reservation.quantity,
          v_stock.on_hand, v_stock.on_hand - v_reservation.quantity,
          v_stock.reserved, v_stock.reserved - v_reservation.quantity,
          old.id, 'صرف تلقائي عند شحن الطلب', auth.uid()
        );
      end loop;
      delete from private.order_inventory_reservations where order_id = old.id;
    elsif v_reserved_count = 0 then
      -- Handles orders confirmed before inventory tracking was introduced.
      if exists (
        select 1 from jsonb_array_elements(old.items) as item(value)
        left join public.products as product
          on product.id = (item.value ->> 'product_id')::bigint
        where product.id is null
      ) then raise exception 'INVENTORY_ORDER_PRODUCT_NOT_FOUND'; end if;
      for v_line in
        select product.id as product_id, product.name as product_name,
          sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(old.items) as item(value)
        join public.products as product
          on product.id = (item.value ->> 'product_id')::bigint
        group by product.id, product.name order by product.id
      loop
        select * into v_stock from public.inventory_stock
        where product_id = v_line.product_id for update;
        if not found or not v_stock.is_initialized then raise exception 'INVENTORY_OPENING_REQUIRED'; end if;
        if v_stock.on_hand - v_stock.reserved < v_line.quantity then
          raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE';
        end if;
        update public.inventory_stock
        set on_hand = on_hand - v_line.quantity, updated_at = now()
        where product_id = v_line.product_id;
        insert into public.inventory_movements (
          product_id, product_name_snapshot, movement_type, quantity_delta,
          quantity_before, quantity_after, reserved_before, reserved_after,
          order_id, notes, created_by
        ) values (
          v_line.product_id, v_line.product_name, 'shipped', -v_line.quantity,
          v_stock.on_hand, v_stock.on_hand - v_line.quantity,
          v_stock.reserved, v_stock.reserved,
          old.id, 'صرف تلقائي عند شحن الطلب', auth.uid()
        );
      end loop;
    else
      raise exception 'INVENTORY_RESERVATION_INVALID';
    end if;
  elsif old.status in ('shipped', 'delivered') and new.status <> 'delivered' then
    raise exception 'ORDER_FULFILLED_CANNOT_REOPEN';
  end if;

  return new;
end;
$$;

-- Legacy reservations are assigned to the old shipment path above; returned
-- stock from this point on must be tied to a completed order and return record.
do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.inventory_movements'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%movement_type%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.inventory_movements drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check check (movement_type in (
    'opening', 'received', 'issued', 'returned', 'return_damaged', 'damaged',
    'count', 'reserved', 'released', 'shipped'
  ));

alter table public.inventory_movements
  add column if not exists quantity_recorded integer not null default 0
  check (quantity_recorded >= 0);

create table if not exists public.order_returns (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  request_payload jsonb not null,
  order_id uuid not null references public.orders(id) on delete restrict,
  refund_amount numeric(12,2) not null check (refund_amount >= 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'mobile_wallet', 'other')),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists order_returns_order_created_idx
  on public.order_returns (order_id, created_at desc);

create table if not exists public.order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.order_returns(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id bigint not null,
  product_name_snapshot text not null,
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  disposition text not null check (disposition in ('restock', 'damaged')),
  created_at timestamptz not null default now(),
  unique (return_id, product_id)
);

create index if not exists order_return_items_order_product_idx
  on public.order_return_items (order_id, product_id);

alter table public.order_returns enable row level security;
alter table public.order_return_items enable row level security;
revoke all on public.order_returns from public, anon, authenticated;
revoke all on public.order_return_items from public, anon, authenticated;
grant select on public.order_returns to authenticated;
grant select on public.order_return_items to authenticated;

drop policy if exists order_returns_admin_select on public.order_returns;
create policy order_returns_admin_select on public.order_returns
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists order_return_items_admin_select on public.order_return_items;
create policy order_return_items_admin_select on public.order_return_items
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter table public.account_entries
  add column if not exists order_return_id uuid references public.order_returns(id) on delete set null;
create unique index if not exists account_entries_order_return_unique_idx
  on public.account_entries (order_return_id) where order_return_id is not null;

create or replace function public.record_order_return(
  p_request_key uuid,
  p_order_id uuid,
  p_items jsonb,
  p_payment_method text default 'other',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_stock public.inventory_stock%rowtype;
  v_return_id uuid;
  v_existing_payload jsonb;
  v_existing_order_id uuid;
  v_payload jsonb;
  v_product_name text;
  v_min_price numeric;
  v_max_price numeric;
  v_unit_price numeric;
  v_ordered_quantity integer;
  v_previously_returned integer;
  v_refund_amount numeric(12,2) := 0;
  v_quantity integer;
  v_product_id bigint;
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if auth.uid() is null or (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'ORDER_RETURN_NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_request_key is null or p_order_id is null
    or p_payment_method is null
    or p_payment_method not in ('cash', 'bank_transfer', 'mobile_wallet', 'other')
    or char_length(coalesce(p_notes, '')) > 500
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) not between 1 and 20
    or exists (
      select 1 from jsonb_array_elements(p_items) as requested(value)
      where jsonb_typeof(requested.value) <> 'object'
        or jsonb_typeof(requested.value -> 'product_id') <> 'number'
        or jsonb_typeof(requested.value -> 'quantity') <> 'number'
        or coalesce(requested.value ->> 'product_id', '') !~ '^[1-9][0-9]{0,17}$'
        or coalesce(requested.value ->> 'quantity', '') !~ '^[1-9][0-9]?$'
        or coalesce(requested.value ->> 'disposition', '') not in ('restock', 'damaged')
    )
    or (select count(*) from jsonb_array_elements(p_items)) <>
       (select count(distinct (requested.value ->> 'product_id')::bigint)
        from jsonb_array_elements(p_items) as requested(value)) then
    raise exception 'ORDER_RETURN_INVALID_ITEMS' using errcode = 'P0001';
  end if;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'items', p_items,
    'payment_method', p_payment_method,
    'notes', v_notes
  );

  select order_returns.id, order_returns.order_id, order_returns.request_payload
  into v_return_id, v_existing_order_id, v_existing_payload
  from public.order_returns where request_key = p_request_key;
  if found then
    if v_existing_order_id = p_order_id and v_existing_payload = v_payload then return v_return_id; end if;
    raise exception 'ORDER_RETURN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_RETURN_ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_order.status <> 'delivered' then
    raise exception 'ORDER_RETURN_ORDER_NOT_DELIVERED' using errcode = 'P0001';
  end if;

  -- Recheck after locking the order, covering two administrators returning the
  -- same order concurrently with the same request key.
  select order_returns.id, order_returns.order_id, order_returns.request_payload
  into v_return_id, v_existing_order_id, v_existing_payload
  from public.order_returns where request_key = p_request_key;
  if found then
    if v_existing_order_id = p_order_id and v_existing_payload = v_payload then return v_return_id; end if;
    raise exception 'ORDER_RETURN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  for v_item in
    select requested.value
    from jsonb_array_elements(p_items) as requested(value)
    order by (requested.value ->> 'product_id')::bigint
  loop
    v_product_id := (v_item.value ->> 'product_id')::bigint;
    v_quantity := (v_item.value ->> 'quantity')::integer;

    select coalesce(max(item.value ->> 'name'), 'منتج'),
      min(coalesce(nullif(item.value ->> 'unit_price', ''), nullif(item.value ->> 'price', ''))::numeric),
      max(coalesce(nullif(item.value ->> 'unit_price', ''), nullif(item.value ->> 'price', ''))::numeric),
      sum((item.value ->> 'quantity')::integer)::integer
    into v_product_name, v_min_price, v_max_price, v_ordered_quantity
    from jsonb_array_elements(v_order.items) as item(value)
    where (item.value ->> 'product_id')::bigint = v_product_id;

    if v_ordered_quantity is null or v_ordered_quantity < 1 then
      raise exception 'ORDER_RETURN_PRODUCT_NOT_IN_ORDER' using errcode = 'P0001';
    end if;
    if v_min_price is null or v_max_price is distinct from v_min_price then
      raise exception 'ORDER_RETURN_PRICE_MISSING' using errcode = 'P0001';
    end if;
    v_unit_price := v_min_price;

    select coalesce(sum(return_item.quantity), 0)::integer into v_previously_returned
    from public.order_return_items as return_item
    where return_item.order_id = p_order_id and return_item.product_id = v_product_id;
    if v_previously_returned + v_quantity > v_ordered_quantity then
      raise exception 'ORDER_RETURN_QUANTITY_EXCEEDED' using errcode = 'P0001';
    end if;

    if v_item.value ->> 'disposition' = 'restock' then
      select * into v_stock from public.inventory_stock
      where product_id = v_product_id for update;
      if not found or not v_stock.is_initialized then
        raise exception 'ORDER_RETURN_INVENTORY_NOT_READY' using errcode = 'P0001';
      end if;
    end if;

    v_refund_amount := v_refund_amount + v_unit_price * v_quantity;
  end loop;

  insert into public.order_returns (
    request_key, request_payload, order_id, refund_amount, payment_method, notes, created_by
  ) values (
    p_request_key, v_payload, p_order_id, v_refund_amount, p_payment_method, v_notes, auth.uid()
  ) on conflict (request_key) do nothing
  returning id into v_return_id;

  if v_return_id is null then
    select id, order_id, request_payload into v_return_id, v_existing_order_id, v_existing_payload
    from public.order_returns where request_key = p_request_key;
    if v_existing_order_id = p_order_id and v_existing_payload = v_payload then return v_return_id; end if;
    raise exception 'ORDER_RETURN_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  for v_item in
    select requested.value
    from jsonb_array_elements(p_items) as requested(value)
    order by (requested.value ->> 'product_id')::bigint
  loop
    v_product_id := (v_item.value ->> 'product_id')::bigint;
    v_quantity := (v_item.value ->> 'quantity')::integer;
    select coalesce(max(item.value ->> 'name'), 'منتج'),
      min(coalesce(nullif(item.value ->> 'unit_price', ''), nullif(item.value ->> 'price', ''))::numeric)
    into v_product_name, v_unit_price
    from jsonb_array_elements(v_order.items) as item(value)
    where (item.value ->> 'product_id')::bigint = v_product_id;

    insert into public.order_return_items (
      return_id, order_id, product_id, product_name_snapshot,
      unit_price, quantity, disposition
    ) values (
      v_return_id, p_order_id, v_product_id, v_product_name,
      v_unit_price, v_quantity, v_item.value ->> 'disposition'
    );

    select * into v_stock from public.inventory_stock
    where product_id = v_product_id for update;
    if v_item.value ->> 'disposition' = 'restock' then
      update public.inventory_stock
      set on_hand = on_hand + v_quantity, updated_at = now()
      where product_id = v_product_id;
      insert into public.inventory_movements (
        product_id, product_name_snapshot, movement_type, quantity_delta,
        reserved_delta, quantity_before, quantity_after, reserved_before,
        reserved_after, quantity_recorded, order_id, notes, created_by
      ) values (
        v_product_id, v_product_name, 'returned', v_quantity,
        0, v_stock.on_hand, v_stock.on_hand + v_quantity,
        v_stock.reserved, v_stock.reserved, v_quantity, p_order_id,
        left(concat('مرتجع صالح من الطلب؛ الكمية ', v_quantity,
          case when v_notes is null then '' else concat('؛ ', v_notes) end), 500), auth.uid()
      );
    else
      insert into public.inventory_movements (
        product_id, product_name_snapshot, movement_type, quantity_delta,
        reserved_delta, quantity_before, quantity_after, reserved_before,
        reserved_after, quantity_recorded, order_id, notes, created_by
      ) values (
        v_product_id, v_product_name, 'return_damaged', 0,
        0, v_stock.on_hand, v_stock.on_hand,
        v_stock.reserved, v_stock.reserved, v_quantity, p_order_id,
        left(concat('مرتجع تالف لم يُضف إلى المخزون المتاح؛ الكمية ', v_quantity,
          case when v_notes is null then '' else concat('؛ ', v_notes) end), 500), auth.uid()
      );
    end if;
  end loop;

  if v_refund_amount > 0 then
    insert into public.account_entries (
      entry_type, category, amount, payment_method, entry_date, order_id,
      order_return_id, reference, notes, created_by
    ) values (
      'expense', 'order_return_refund', v_refund_amount, p_payment_method,
      (now() at time zone 'Africa/Cairo')::date, p_order_id, v_return_id,
      concat('مرتجع طلب ', left(p_order_id::text, 8)),
      left(concat('رد قيمة المنتجات فقط؛ لم يشمل الشحن.',
        case when v_notes is null then '' else concat(' ', v_notes) end), 500),
      auth.uid()
    );
  end if;

  return v_return_id;
end;
$$;

revoke all on function public.record_order_return(uuid, uuid, jsonb, text, text) from public, anon;
grant execute on function public.record_order_return(uuid, uuid, jsonb, text, text) to authenticated;

create or replace function public.record_inventory_movement(
  p_product_id bigint,
  p_movement_type text,
  p_quantity integer,
  p_reorder_level integer default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product_name text;
  v_stock public.inventory_stock%rowtype;
  v_new_quantity integer;
  v_new_reorder integer;
  v_new_initialized boolean;
  v_movement_id uuid;
begin
  if auth.uid() is null or (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception 'INVENTORY_NOT_AUTHORIZED';
  end if;
  if p_quantity is null or p_quantity < 0
    or (p_reorder_level is not null and p_reorder_level < 0)
    or char_length(coalesce(p_notes, '')) > 500
    or p_movement_type not in ('opening', 'received', 'issued', 'damaged', 'count') then
    raise exception 'INVENTORY_INVALID_MOVEMENT';
  end if;

  select name into v_product_name from public.products where id = p_product_id;
  if not found then raise exception 'INVENTORY_PRODUCT_NOT_FOUND'; end if;
  insert into public.inventory_stock (product_id) values (p_product_id)
  on conflict (product_id) do nothing;
  select * into v_stock from public.inventory_stock where product_id = p_product_id for update;

  if p_movement_type = 'opening' then
    if v_stock.is_initialized then raise exception 'INVENTORY_ALREADY_INITIALIZED'; end if;
    v_new_quantity := p_quantity;
    v_new_initialized := true;
  else
    if not v_stock.is_initialized then raise exception 'INVENTORY_OPENING_REQUIRED'; end if;
    v_new_quantity := v_stock.on_hand;
    v_new_initialized := true;
    if p_movement_type = 'received' then
      if p_quantity = 0 then raise exception 'INVENTORY_INVALID_MOVEMENT'; end if;
      v_new_quantity := v_stock.on_hand + p_quantity;
    elsif p_movement_type in ('issued', 'damaged') then
      if p_quantity = 0 or v_stock.on_hand - v_stock.reserved < p_quantity then
        raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE';
      end if;
      v_new_quantity := v_stock.on_hand - p_quantity;
    elsif p_movement_type = 'count' then
      if p_quantity < v_stock.reserved then raise exception 'INVENTORY_COUNT_BELOW_RESERVED'; end if;
      v_new_quantity := p_quantity;
    end if;
  end if;

  v_new_reorder := coalesce(p_reorder_level, v_stock.reorder_level);
  update public.inventory_stock set on_hand = v_new_quantity,
    reorder_level = v_new_reorder, is_initialized = v_new_initialized, updated_at = now()
  where product_id = p_product_id;
  insert into public.inventory_movements (
    product_id, product_name_snapshot, movement_type, quantity_delta,
    quantity_before, quantity_after, reserved_before, reserved_after,
    reorder_level_before, reorder_level_after, notes, created_by
  ) values (
    p_product_id, v_product_name, p_movement_type,
    v_new_quantity - v_stock.on_hand,
    v_stock.on_hand, v_new_quantity, v_stock.reserved, v_stock.reserved,
    v_stock.reorder_level, v_new_reorder,
    nullif(btrim(coalesce(p_notes, '')), ''), auth.uid()
  ) returning id into v_movement_id;
  return v_movement_id;
end;
$$;

revoke all on function public.record_inventory_movement(bigint, text, integer, integer, text) from public, anon;
grant execute on function public.record_inventory_movement(bigint, text, integer, integer, text) to authenticated;
