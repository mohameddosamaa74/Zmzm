-- Apply this migration, then database/order-security-migration.sql, before enabling checkout.
-- Public clients submit orders through the validated create-order Edge Function.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  idempotency_key uuid,
  first_name text not null,
  last_name text not null,
  phone text not null check (phone ~ '^01[0125][0-9]{8}$'),
  governorate text not null,
  city text not null,
  address text not null,
  building text not null,
  floor text not null,
  apartment text not null,
  notes text,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  subtotal numeric not null check (subtotal >= 0),
  shipping numeric not null check (shipping >= 0),
  total numeric not null check (total >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'))
);

alter table public.orders enable row level security;
revoke all on public.orders from public, anon, authenticated;
grant select, update on public.orders to authenticated;
create index if not exists orders_created_at_idx on public.orders (created_at desc);

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'orders'
  loop
    execute format('drop policy %I on public.orders', policy_name);
  end loop;
end $$;

create policy "orders_admin_select"
on public.orders
for select
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create policy "orders_admin_update"
on public.orders
for update
to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
