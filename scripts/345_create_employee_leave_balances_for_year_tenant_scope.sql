BEGIN;

CREATE OR REPLACE FUNCTION public.create_employee_leave_balances_for_year(p_employee_id text, p_year integer DEFAULT NULL::integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_tenant_id uuid := current_user_tenant_id();
  v_employee employees%ROWTYPE;
  v_lt RECORD;
  v_entitled numeric(8, 2);
  v_inserted integer := 0;
  v_rowcount integer;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  ) THEN
    RAISE EXCEPTION 'Not authorized to create employee leave balances';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = p_employee_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee % not found', p_employee_id;
  END IF;

  IF v_employee.tenant_id IS NULL OR NOT tenant_matches(v_employee.tenant_id) THEN
    RAISE EXCEPTION 'Tenant mismatch for employee %', p_employee_id;
  END IF;

  FOR v_lt IN
    SELECT lt.id, lt.type_name
    FROM leave_types lt
    WHERE lt.tenant_id = v_employee.tenant_id
      AND lt.type_name = ANY (ARRAY[
        'Annual Leave'::text,
        'Sick Leave'::text,
        'Unpaid Leave'::text
      ])
  LOOP
    v_entitled := public.resolve_leave_entitlement(
      v_employee.tenant_id,
      v_employee."position",
      v_employee.employment_type,
      v_lt.type_name
    );

    INSERT INTO employee_leave_balances (
      tenant_id,
      employee_id,
      leave_type_id,
      year,
      entitled_days,
      days_used
    )
    VALUES (
      v_employee.tenant_id,
      v_employee.employee_id,
      v_lt.id,
      v_year,
      v_entitled,
      0
    )
    ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
