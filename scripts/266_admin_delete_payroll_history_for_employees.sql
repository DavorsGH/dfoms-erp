-- Scoped payroll_history delete (BU reopen/release). Disables protect trigger.
CREATE OR REPLACE FUNCTION public.admin_delete_payroll_history_for_employees(
  p_month date,
  p_tenant_id uuid,
  p_employee_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  deleted_count integer := 0;
BEGIN
  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RETURN 0;
  END IF;

  ALTER TABLE payroll_history DISABLE TRIGGER trg_protect_locked_payroll;

  DELETE FROM payroll_history
  WHERE payroll_month = p_month
    AND tenant_id = p_tenant_id
    AND employee_id = ANY (p_employee_ids);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  ALTER TABLE payroll_history ENABLE TRIGGER trg_protect_locked_payroll;
  RETURN deleted_count;
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      ALTER TABLE payroll_history ENABLE TRIGGER trg_protect_locked_payroll;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_payroll_history_for_employees(date, uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_payroll_history_for_employees(date, uuid, text[]) TO service_role;
