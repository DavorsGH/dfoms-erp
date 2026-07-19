-- Script 71: Tenant-scope admin_delete_payroll_history_for_month RPC
-- Previous version deleted ALL tenants' payroll_history rows for a given
-- month (SECURITY DEFINER, no tenant filter) — cross-tenant destructive bug.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_delete_payroll_history_for_month(
  p_month date,
  p_tenant_id uuid
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  alter table payroll_history disable trigger trg_protect_locked_payroll;
  delete from payroll_history where payroll_month = p_month and tenant_id = p_tenant_id;
  alter table payroll_history enable trigger trg_protect_locked_payroll;
end;
$function$;

COMMIT;
