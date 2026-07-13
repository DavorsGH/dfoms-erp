-- Preserve payroll_processing fields needed for partial-lock reopen.
alter table payroll_history
  add column if not exists days_to_pay integer,
  add column if not exists daily_rate numeric(10,4);
