-- Apply after admin-inventory-accounts-migration.sql.
-- Records product revenue once when an order status changes to delivered.
-- Also backfills existing delivered orders using the original order date.
-- Shipping is intentionally excluded; orders with an existing income entry are skipped.

create unique index if not exists account_entries_delivered_order_income_unique_idx
  on public.account_entries (order_id)
  where entry_type = 'income'
    and category = 'delivered_order'
    and order_id is not null;

create or replace function public.record_delivered_order_income()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'delivered'
    and old.status is distinct from new.status
    and new.subtotal > 0 then
    insert into public.account_entries (
      entry_type,
      category,
      amount,
      payment_method,
      entry_date,
      order_id,
      reference,
      notes
    ) values (
      'income',
      'delivered_order',
      new.subtotal,
      'other',
      (now() at time zone 'Africa/Cairo')::date,
      new.id,
      'قيمة المنتجات عند التسليم',
      'قيد تلقائي؛ يشمل المنتجات فقط ولا يشمل رسوم الشحن.'
    )
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.record_delivered_order_income() from public, anon, authenticated;

drop trigger if exists orders_record_delivered_order_income on public.orders;
create trigger orders_record_delivered_order_income
after update of status on public.orders
for each row
when (new.status = 'delivered' and old.status is distinct from new.status)
execute function public.record_delivered_order_income();

-- Backfill previously delivered orders. Re-running this file is safe: existing
-- income for an order is left alone, and the unique index prevents duplicate
-- automatic delivered-order entries.
insert into public.account_entries (
  entry_type,
  category,
  amount,
  payment_method,
  entry_date,
  order_id,
  reference,
  notes
)
select
  'income',
  'delivered_order',
  orders.subtotal,
  'other',
  (orders.created_at at time zone 'Africa/Cairo')::date,
  orders.id,
  'قيمة المنتجات بأثر رجعي',
  'قيد تلقائي بأثر رجعي من تاريخ الطلب؛ يشمل المنتجات فقط ولا يشمل رسوم الشحن.'
from public.orders as orders
where orders.status = 'delivered'
  and orders.subtotal > 0
  and not exists (
    select 1
    from public.account_entries as existing_entry
    where existing_entry.order_id = orders.id
      and existing_entry.entry_type = 'income'
  )
on conflict do nothing;
