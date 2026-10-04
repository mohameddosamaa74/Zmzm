-- Apply after admin-inventory-accounts-migration.sql.
-- The storefront needs the remaining sellable count to cap cart controls.
-- This exposes only the available quantity, not on_hand or reserved separately.

drop function if exists public.get_public_product_availability();

create function public.get_public_product_availability()
returns table (
  product_id bigint,
  available boolean,
  available_quantity integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    product.id,
    case
      when stock.is_initialized is distinct from true then null
      else stock.on_hand > stock.reserved
    end as available,
    case
      when stock.is_initialized is distinct from true then null
      else greatest(stock.on_hand - stock.reserved, 0)
    end as available_quantity
  from public.products as product
  left join public.inventory_stock as stock on stock.product_id = product.id
  order by product.id;
$$;

revoke all on function public.get_public_product_availability() from public, anon, authenticated;
grant execute on function public.get_public_product_availability() to anon, authenticated;
