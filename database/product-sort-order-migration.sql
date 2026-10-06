-- Apply this before deploying the admin drag-and-drop product ordering UI.
-- The first storefront order remains the existing ascending product ID order.

create sequence if not exists public.products_sort_order_seq;

alter table public.products
  add column if not exists sort_order bigint;

update public.products
set sort_order = id
where sort_order is null;

select setval(
  'public.products_sort_order_seq',
  greatest(coalesce((select max(sort_order) from public.products), 0) + 1, 1),
  false
);

alter table public.products
  alter column sort_order set default nextval('public.products_sort_order_seq'),
  alter column sort_order set not null;

grant usage, select on sequence public.products_sort_order_seq to authenticated;

create index if not exists products_sort_order_id_idx
  on public.products (sort_order asc, id asc);

create or replace function public.reorder_products(p_product_ids bigint[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_product_count bigint;
  requested_product_count bigint;
  requested_unique_count bigint;
begin
  if auth.uid() is null
     or (auth.jwt() -> 'app_metadata' ->> 'role') is distinct from 'admin' then
    raise exception using message = 'PRODUCT_REORDER_NOT_AUTHORIZED', errcode = '42501';
  end if;

  lock table public.products in share row exclusive mode;

  requested_product_count := coalesce(cardinality(p_product_ids), 0);
  select count(*) into current_product_count from public.products;

  if requested_product_count <> current_product_count then
    raise exception using message = 'PRODUCT_ORDER_INVALID', errcode = '22023';
  end if;

  select count(distinct requested.product_id)
  into requested_unique_count
  from unnest(coalesce(p_product_ids, array[]::bigint[])) as requested(product_id);

  if requested_unique_count <> requested_product_count
     or exists (
       select 1
       from unnest(coalesce(p_product_ids, array[]::bigint[])) as requested(product_id)
       left join public.products as product on product.id = requested.product_id
       where product.id is null
     ) then
    raise exception using message = 'PRODUCT_ORDER_INVALID', errcode = '22023';
  end if;

  update public.products as product
  set sort_order = requested.position - 1
  from unnest(p_product_ids) with ordinality as requested(product_id, position)
  where product.id = requested.product_id;
end;
$$;

revoke all on function public.reorder_products(bigint[]) from public, anon, authenticated;
grant execute on function public.reorder_products(bigint[]) to authenticated;

comment on column public.products.sort_order is
  'Admin-controlled storefront display order; lower values appear first.';
