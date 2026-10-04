-- Apply after order-security-migration.sql and admin-inventory-accounts-migration.sql.
-- Reject new pending orders whose requested quantities exceed current available stock.

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
  if new.status <> 'pending' then
    return new;
  end if;

  for v_line in
    select
      (item.value ->> 'product_id')::bigint as product_id,
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

revoke all on function private.validate_order_inventory_availability() from public, anon, authenticated;

drop trigger if exists orders_validate_inventory_before_insert on public.orders;
create trigger orders_validate_inventory_before_insert
before insert on public.orders
for each row execute function private.validate_order_inventory_availability();
