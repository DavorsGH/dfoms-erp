-- Reusable SECURITY DEFINER helper for locked payroll_history statutory patches.
create or replace function public.admin_update_payroll_history_statutory(
  p_tenant_id uuid,
  p_payroll_month date,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
  matched integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  alter table payroll_history disable trigger trg_protect_locked_payroll;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    update payroll_history
    set
      employee_ssnit = coalesce((r->>'employee_ssnit')::numeric, employee_ssnit),
      employer_ssnit = coalesce((r->>'employer_ssnit')::numeric, employer_ssnit),
      tier2 = coalesce((r->>'tier2')::numeric, tier2),
      paye_tax = coalesce((r->>'paye_tax')::numeric, paye_tax)
    where tenant_id = p_tenant_id
      and payroll_month = p_payroll_month
      and id = (r->>'id')::uuid;

    get diagnostics matched = row_count;
    if matched <> 1 then
      raise exception 'Expected 1 row for id %, matched %', r->>'id', matched;
    end if;
    n := n + 1;
  end loop;

  alter table payroll_history enable trigger trg_protect_locked_payroll;
  return n;
exception
  when others then
    begin
      alter table payroll_history enable trigger trg_protect_locked_payroll;
    exception when others then
      null;
    end;
    raise;
end;
$$;

revoke all on function public.admin_update_payroll_history_statutory(uuid, date, jsonb) from public;
grant execute on function public.admin_update_payroll_history_statutory(uuid, date, jsonb) to service_role;
