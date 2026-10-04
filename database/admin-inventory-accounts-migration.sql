-- Apply after the existing orders and order-security SQL files.
-- Adds an admin-only stock ledger and internal cashbook.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.inventory_stock (
  product_id bigint primary key references public.products(id) on delete cascade,
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  reorder_level integer not null default 0 check (reorder_level >= 0),
  is_initialized boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.inventory_stock (product_id)
select id from public.products
on conflict (product_id) do nothing;

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id bigint references public.products(id) on delete set null,
  product_name_snapshot text not null,
  movement_type text not null check (movement_type in (
    'opening', 'received', 'issued', 'returned', 'damaged', 'count',
    'reserved', 'released', 'shipped'
  )),
  quantity_delta integer not null,
  reserved_delta integer not null default 0,
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  reserved_before integer not null check (reserved_before >= 0),
  reserved_after integer not null check (reserved_after >= 0),
  reorder_level_before integer check (reorder_level_before is null or reorder_level_before >= 0),
  reorder_level_after integer check (reorder_level_after is null or reorder_level_after >= 0),
  order_id uuid references public.orders(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_created_at_idx
  on public.inventory_movements (created_at desc);
create index if not exists inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_order_idx
  on public.inventory_movements (order_id);

create table if not exists public.account_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('income', 'expense')),
  category text not null check (char_length(category) between 1 and 80),
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('cash', 'bank_transfer', 'mobile_wallet', 'other')),
  entry_date date not null default current_date,
  order_id uuid references public.orders(id) on delete set null,
  reference text check (reference is null or char_length(reference) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists account_entries_entry_date_idx
  on public.account_entries (entry_date desc, created_at desc);
create index if not exists account_entries_order_idx
  on public.account_entries (order_id) where order_id is not null;

alter table public.inventory_stock enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.account_entries enable row level security;

revoke all on public.inventory_stock from public, anon, authenticated;
revoke all on public.inventory_movements from public, anon, authenticated;
revoke all on public.account_entries from public, anon, authenticated;
grant select on public.inventory_stock to authenticated;
grant select on public.inventory_movements to authenticated;
grant select, insert on public.account_entries to authenticated;

drop policy if exists "inventory_stock_admin_select" on public.inventory_stock;
create policy "inventory_stock_admin_select"
on public.inventory_stock for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "inventory_movements_admin_select" on public.inventory_movements;
create policy "inventory_movements_admin_select"
on public.inventory_movements for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "account_entries_admin_select" on public.account_entries;
create policy "account_entries_admin_select"
on public.account_entries for select to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists "account_entries_admin_insert" on public.account_entries;
create policy "account_entries_admin_insert"
on public.account_entries for insert to authenticated
with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  and created_by = auth.uid()
);

-- New products receive an uncounted stock row; no stock level is guessed.
create or replace function public.ensure_product_inventory_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.inventory_stock (product_id)
  values (new.id)
  on conflict (product_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_product_inventory_row() from public, anon, authenticated;
drop trigger if exists products_create_inventory_row on public.products;
create trigger products_create_inventory_row
after insert on public.products
for each row execute function public.ensure_product_inventory_row();

-- Stock is changed through this locked, audited operation, never by editing a balance directly.
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
    or p_movement_type not in ('opening', 'received', 'issued', 'returned', 'damaged', 'count') then
    raise exception 'INVENTORY_INVALID_MOVEMENT';
  end if;

  select name into v_product_name
  from public.products
  where id = p_product_id;
  if not found then
    raise exception 'INVENTORY_PRODUCT_NOT_FOUND';
  end if;

  insert into public.inventory_stock (product_id)
  values (p_product_id)
  on conflict (product_id) do nothing;

  select * into v_stock
  from public.inventory_stock
  where product_id = p_product_id
  for update;

  if p_movement_type = 'opening' then
    if v_stock.is_initialized then
      raise exception 'INVENTORY_ALREADY_INITIALIZED';
    end if;
    v_new_quantity := p_quantity;
    v_new_initialized := true;
  else
    if not v_stock.is_initialized then
      raise exception 'INVENTORY_OPENING_REQUIRED';
    end if;
    v_new_quantity := v_stock.on_hand;
    v_new_initialized := true;
    if p_movement_type = 'received' or p_movement_type = 'returned' then
      if p_quantity = 0 then raise exception 'INVENTORY_INVALID_MOVEMENT'; end if;
      v_new_quantity := v_stock.on_hand + p_quantity;
    elsif p_movement_type = 'issued' or p_movement_type = 'damaged' then
      if p_quantity = 0 or v_stock.on_hand - v_stock.reserved < p_quantity then
        raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE';
      end if;
      v_new_quantity := v_stock.on_hand - p_quantity;
    elsif p_movement_type = 'count' then
      if p_quantity < v_stock.reserved then
        raise exception 'INVENTORY_COUNT_BELOW_RESERVED';
      end if;
      v_new_quantity := p_quantity;
    end if;
  end if;

  v_new_reorder := coalesce(p_reorder_level, v_stock.reorder_level);
  update public.inventory_stock
  set on_hand = v_new_quantity,
      reorder_level = v_new_reorder,
      is_initialized = v_new_initialized,
      updated_at = now()
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

-- Active reservations are operational state; the public movement ledger keeps the audit history.
create table if not exists private.order_inventory_reservations (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete restrict,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (order_id, product_id)
);
revoke all on table private.order_inventory_reservations from public, anon, authenticated;

-- Order confirmation reserves stock; shipment consumes it; cancellation releases it.
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
      select 1
      from jsonb_array_elements(old.items) as item(value)
      left join public.products as product
        on product.id = (item.value ->> 'product_id')::bigint
      where product.id is null
    ) then
      raise exception 'INVENTORY_ORDER_PRODUCT_NOT_FOUND';
    end if;

    for v_line in
      select product.id as product_id, product.name as product_name,
        sum((item.value ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(old.items) as item(value)
      join public.products as product
        on product.id = (item.value ->> 'product_id')::bigint
      group by product.id, product.name
      order by product.id
    loop
      select * into v_stock
      from public.inventory_stock
      where product_id = v_line.product_id
      for update;
      if not found or not v_stock.is_initialized then
        raise exception 'INVENTORY_OPENING_REQUIRED';
      end if;
      if v_stock.on_hand - v_stock.reserved < v_line.quantity then
        raise exception 'INVENTORY_INSUFFICIENT_AVAILABLE';
      end if;

      update public.inventory_stock
      set reserved = reserved + v_line.quantity, updated_at = now()
      where product_id = v_line.product_id;
      insert into private.order_inventory_reservations (
        order_id, product_id, product_name_snapshot, quantity
      ) values (
        new.id, v_line.product_id, v_line.product_name, v_line.quantity
      );
      insert into public.inventory_movements (
        product_id, product_name_snapshot, movement_type, quantity_delta,
        reserved_delta, quantity_before, quantity_after, reserved_before,
        reserved_after, order_id, notes, created_by
      ) values (
        v_line.product_id, v_line.product_name, 'reserved', 0,
        v_line.quantity, v_stock.on_hand, v_stock.on_hand, v_stock.reserved,
        v_stock.reserved + v_line.quantity, new.id,
        'حجز تلقائي عند تأكيد الطلب', auth.uid()
      );
    end loop;
  elsif new.status = 'cancelled' and old.status in ('confirmed', 'processing') then
    for v_reservation in
      select * from private.order_inventory_reservations
      where order_id = old.id
      order by product_id
    loop
      select * into v_stock
      from public.inventory_stock
      where product_id = v_reservation.product_id
      for update;
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
        where order_id = old.id
        order by product_id
      loop
        select * into v_stock
        from public.inventory_stock
        where product_id = v_reservation.product_id
        for update;
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
      -- Handles orders confirmed before this migration was applied.
      if exists (
        select 1 from jsonb_array_elements(old.items) as item(value)
        left join public.products as product
          on product.id = (item.value ->> 'product_id')::bigint
        where product.id is null
      ) then
        raise exception 'INVENTORY_ORDER_PRODUCT_NOT_FOUND';
      end if;
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
        if not found or not v_stock.is_initialized then
          raise exception 'INVENTORY_OPENING_REQUIRED';
        end if;
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

revoke all on function public.sync_order_inventory_status() from public, anon, authenticated;
drop trigger if exists orders_sync_inventory_status on public.orders;
create trigger orders_sync_inventory_status
after update of status on public.orders
for each row execute function public.sync_order_inventory_status();

-- Aggregate monthly totals without loading every account entry into the browser.
create or replace function public.get_account_month_summary(p_month_start date)
returns table (income_total numeric, expense_total numeric, entry_count bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    coalesce(sum(amount) filter (where entry_type = 'income'), 0),
    coalesce(sum(amount) filter (where entry_type = 'expense'), 0),
    count(*)
  from public.account_entries
  where entry_date >= p_month_start
    and entry_date < (p_month_start + interval '1 month')::date;
$$;

revoke all on function public.get_account_month_summary(date) from public, anon;
grant execute on function public.get_account_month_summary(date) to authenticated;

-- Aggregate stock activity for the current month; RLS on the source ledger still applies.
create or replace function public.get_inventory_month_summary(p_month_start date)
returns table (movement_count bigint, units_received bigint, units_issued bigint)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    count(*),
    coalesce(sum(quantity_delta) filter (where movement_type in ('opening', 'received', 'returned') and quantity_delta > 0), 0),
    coalesce(sum(-quantity_delta) filter (where movement_type in ('issued', 'damaged', 'shipped') and quantity_delta < 0), 0)
  from public.inventory_movements
  where created_at >= (p_month_start::timestamp at time zone 'Africa/Cairo')
    and created_at < ((p_month_start + interval '1 month')::timestamp at time zone 'Africa/Cairo');
$$;

revoke all on function public.get_inventory_month_summary(date) from public, anon;
grant execute on function public.get_inventory_month_summary(date) to authenticated;
