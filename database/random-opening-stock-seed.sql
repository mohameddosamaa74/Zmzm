-- One-time setup for the eight existing products.
-- Product IDs 2 and 7 are intentionally zero; the other six get random values from 1 to 10.
-- This records each value as an opening movement. The values are user-requested and should
-- be checked against physical stock before confirming customer orders.

begin;

do $$
declare
  v_product record;
  v_stock public.inventory_stock%rowtype;
  v_product_count integer;
begin
  select count(*) into v_product_count
  from public.products
  where id between 1 and 8;

  if v_product_count <> 8 then
    raise exception 'Expected existing product IDs 1 through 8; no stock was changed.';
  end if;

  if exists (
    select 1
    from public.inventory_stock
    where product_id between 1 and 8
      and (is_initialized or on_hand <> 0 or reserved <> 0)
  ) then
    raise exception 'At least one product already has stock data; no stock was changed.';
  end if;

  for v_product in
    select
      product.id as product_id,
      product.name as product_name,
      case
        when product.id in (2, 7) then 0
        else floor(random() * 10)::integer + 1
      end as opening_quantity
    from public.products as product
    where product.id between 1 and 8
    order by product.id
  loop
    select * into v_stock
    from public.inventory_stock
    where product_id = v_product.product_id
    for update;

    if not found then
      raise exception 'Inventory row missing for product %; no stock was changed.', v_product.product_id;
    end if;

    update public.inventory_stock
    set on_hand = v_product.opening_quantity,
        reserved = 0,
        is_initialized = true,
        updated_at = now()
    where product_id = v_product.product_id;

    insert into public.inventory_movements (
      product_id,
      product_name_snapshot,
      movement_type,
      quantity_delta,
      reserved_delta,
      quantity_before,
      quantity_after,
      reserved_before,
      reserved_after,
      reorder_level_before,
      reorder_level_after,
      notes
    ) values (
      v_product.product_id,
      v_product.product_name,
      'opening',
      v_product.opening_quantity - v_stock.on_hand,
      -v_stock.reserved,
      v_stock.on_hand,
      v_product.opening_quantity,
      v_stock.reserved,
      0,
      v_stock.reorder_level,
      v_stock.reorder_level,
      'User-requested random opening quantity; verify against physical stock before confirming orders.'
    );
  end loop;
end;
$$;

commit;
