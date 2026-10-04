-- Apply after order-reservation-returns-migration.sql.
-- Record product refunds as sales returns, separate from operating expenses.

do $$
begin
  if to_regprocedure('public.record_order_return(uuid,uuid,jsonb,text,text)') is not null
    and to_regprocedure('private.record_order_return_impl(uuid,uuid,jsonb,text,text)') is null then
    alter function public.record_order_return(uuid,uuid,jsonb,text,text) set schema private;
    alter function private.record_order_return(uuid,uuid,jsonb,text,text) rename to record_order_return_impl;
  end if;
end $$;

do $$
declare constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.account_entries'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%entry_type%'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.account_entries drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.account_entries
  add constraint account_entries_entry_type_check
  check (entry_type in ('income', 'expense', 'sales_return'));

-- Correct returns already registered by the previous version of the return RPC.
update public.account_entries
set entry_type = 'sales_return', category = 'sales_return'
where category = 'order_return_refund'
  and entry_type = 'expense';

-- Keep the original return validation, stock ledger, and idempotency behavior;
-- convert its linked ledger row to a sales-return adjustment before commit.
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
  v_return_id uuid;
begin
  v_return_id := private.record_order_return_impl(
    p_request_key, p_order_id, p_items, p_payment_method, p_notes
  );

  update public.account_entries
  set entry_type = 'sales_return', category = 'sales_return'
  where order_return_id = v_return_id
    and category in ('order_return_refund', 'sales_return');

  return v_return_id;
end;
$$;

revoke all on function private.record_order_return_impl(uuid,uuid,jsonb,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_order_return(uuid,uuid,jsonb,text,text)
  from public, anon;
grant execute on function public.record_order_return(uuid,uuid,jsonb,text,text)
  to authenticated;

drop function if exists public.get_account_month_summary(date);
create function public.get_account_month_summary(p_month_start date)
returns table (
  income_total numeric,
  sales_returns_total numeric,
  expense_total numeric,
  entry_count bigint
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select
    coalesce(sum(amount) filter (where entry_type = 'income'), 0),
    coalesce(sum(amount) filter (where entry_type = 'sales_return'), 0),
    coalesce(sum(amount) filter (where entry_type = 'expense'), 0),
    count(*)
  from public.account_entries
  where entry_date >= p_month_start
    and entry_date < (p_month_start + interval '1 month')::date;
$$;

revoke all on function public.get_account_month_summary(date) from public, anon;
grant execute on function public.get_account_month_summary(date) to authenticated;
