-- Shared product category names for the storefront and admin portal.
-- Category IDs remain stable when names are edited, so existing products
-- keep their category assignment while every screen displays the new name.

create table if not exists public.product_categories (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists product_categories_name_lower_idx
  on public.product_categories (lower(name));

insert into public.product_categories (id, name, sort_order)
values
  ('boards', 'قواعد كيك', 1),
  ('boxes', 'علب الكيك', 2),
  ('cupcakes', 'كب كيك', 3),
  ('packaging', 'تغليف', 4),
  ('bags', 'شنط', 5),
  ('toppers', 'توبرات', 6)
on conflict (id) do update
set sort_order = excluded.sort_order;

alter table public.product_categories enable row level security;
revoke all on public.product_categories from public, anon, authenticated;
grant select on public.product_categories to anon, authenticated;
grant insert, update on public.product_categories to authenticated;

drop policy if exists product_categories_public_select on public.product_categories;
create policy product_categories_public_select
on public.product_categories
for select
to anon, authenticated
using (true);

drop policy if exists product_categories_admin_insert on public.product_categories;
create policy product_categories_admin_insert
on public.product_categories
for insert
to authenticated
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists product_categories_admin_update on public.product_categories;
create policy product_categories_admin_update
on public.product_categories
for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
