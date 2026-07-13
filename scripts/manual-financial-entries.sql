create table if not exists public.manual_financial_entries (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  purchase_of_fixed_assets numeric not null default 0,
  loan_proceeds numeric not null default 0,
  loan_repayments numeric not null default 0,
  opening_cash_balance numeric not null default 0,
  other_cash_inflows numeric not null default 0,
  unique (period_month)
);

alter table public.manual_financial_entries enable row level security;

create policy "Authenticated users can read manual financial entries"
  on public.manual_financial_entries
  for select
  to authenticated
  using (true);

create policy "Authenticated users can insert manual financial entries"
  on public.manual_financial_entries
  for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update manual financial entries"
  on public.manual_financial_entries
  for update
  to authenticated
  using (true)
  with check (true);
