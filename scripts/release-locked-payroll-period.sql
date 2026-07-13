-- Allows super-admin release of mistakenly permanent-locked payroll periods.
-- Run once in Supabase SQL editor before using POST /api/hr-payroll/release-period.

create or replace function admin_delete_payroll_history_for_month(p_month date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table payroll_history disable trigger trg_protect_locked_payroll;
  delete from payroll_history where payroll_month = p_month;
  alter table payroll_history enable trigger trg_protect_locked_payroll;
end;
$$;

revoke all on function admin_delete_payroll_history_for_month(date) from public;
grant execute on function admin_delete_payroll_history_for_month(date) to service_role;
