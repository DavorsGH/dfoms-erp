BEGIN;

CREATE OR REPLACE FUNCTION public.can_manage_leave_balances()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.submit_leave_request__impl(
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id TEXT;
  v_days NUMERIC(8, 2);
  v_approver UUID;
  v_year INTEGER;
  v_remaining NUMERIC(8, 2);
  v_exceeds BOOLEAN := false;
  v_request_id UUID;
BEGIN
  v_employee_id := current_user_employee_id();
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Your user account is not linked to an employee record';
  END IF;

  v_days := calculate_leave_days(p_start_date, p_end_date);
  IF v_days <= 0 THEN
    RAISE EXCEPTION 'Invalid leave date range';
  END IF;

  v_approver := current_leave_approver_auth_uid();
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'No leave approver is configured';
  END IF;

  v_year := EXTRACT(YEAR FROM p_start_date)::INTEGER;

  SELECT days_remaining
  INTO v_remaining
  FROM employee_leave_balances
  WHERE employee_id = v_employee_id
    AND leave_type_id = p_leave_type_id
    AND year = v_year;

  IF v_remaining IS NOT NULL AND v_days > v_remaining THEN
    v_exceeds := true;
  END IF;

  INSERT INTO leave_requests (
    employee_id,
    leave_type_id,
    start_date,
    end_date,
    days_requested,
    reason,
    status,
    approver_user_account_id,
    exceeds_balance
  )
  VALUES (
    v_employee_id,
    p_leave_type_id,
    p_start_date,
    p_end_date,
    v_days,
    NULLIF(TRIM(p_reason), ''),
    'Pending',
    v_approver,
    v_exceeds
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_leave_request__impl(uuid, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request__impl(uuid, date, date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_my_leave_balances_for_year(
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_year integer := COALESCE(p_year, v_current_year);
  v_employee_id text := current_user_employee_id();
  v_tenant_id uuid := current_user_tenant_id();
  v_employee employees%ROWTYPE;
  v_lt RECORD;
  v_entitled numeric(8, 2);
  v_inserted integer := 0;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Your user account is not linked to an employee record';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Your user account has no tenant context';
  END IF;

  IF v_year < v_current_year - 1 OR v_year > v_current_year + 1 THEN
    RAISE EXCEPTION 'Year % is outside the allowed range (% .. %)',
      v_year, v_current_year - 1, v_current_year + 1;
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = v_employee_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee % not found in your tenant', v_employee_id;
  END IF;

  PERFORM public.assert_caller_can_act_for_tenant(v_tenant_id);

  FOR v_lt IN
    SELECT lt.id, lt.type_name
    FROM leave_types lt
    WHERE lt.tenant_id = v_tenant_id
      AND lt.type_name = ANY (ARRAY[
        'Annual Leave'::text,
        'Sick Leave'::text,
        'Unpaid Leave'::text
      ])
  LOOP
    v_entitled := public.resolve_leave_entitlement(
      v_tenant_id,
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
    SELECT
      v_tenant_id,
      v_employee.employee_id,
      v_lt.id,
      v_year,
      v_entitled,
      0
    WHERE NOT EXISTS (
      SELECT 1
      FROM employee_leave_balances elb
      WHERE elb.tenant_id = v_tenant_id
        AND elb.employee_id = v_employee.employee_id
        AND elb.leave_type_id = v_lt.id
        AND elb.year = v_year
    );

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_leave_balances_for_year(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_leave_balances_for_year(integer) TO authenticated, service_role;

DROP POLICY IF EXISTS leave_requests_insert ON public.leave_requests;

DROP POLICY IF EXISTS leave_requests_update ON public.leave_requests;
CREATE POLICY leave_requests_update
  ON public.leave_requests
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_manage_leave_balances())
  WITH CHECK (tenant_matches(tenant_id) AND can_manage_leave_balances());

NOTIFY pgrst, 'reload schema';

COMMIT;
