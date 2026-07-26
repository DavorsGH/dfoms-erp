-- Script 119: Leave entitlement policy (defaults by Position × Employment Type × Leave Type).
-- Staging first. Do NOT apply to production until explicitly approved.
--
-- Creates:
--   leave_entitlement_policy — tenant-scoped entitlement matrix
--   resolve_leave_entitlement(...) — SQL lookup with Annual=15 / Sick=0 / Unpaid=0 fallback
-- Updates approve_leave_request skeleton create to use that lookup (forward-only).
--
-- RLS: super_admin policies use tenant_matches(tenant_id) AND is_super_admin()
-- from day one (do NOT repeat script 117's unrestricted is_super_admin() mistake).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. leave_entitlement_policy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_entitlement_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  "position" text NOT NULL,
  employment_type text NOT NULL,
  leave_type text NOT NULL,
  entitled_days numeric(8, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_entitlement_policy_employment_type_check
    CHECK (employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text])),
  CONSTRAINT leave_entitlement_policy_leave_type_check
    CHECK (leave_type = ANY (ARRAY[
      'Annual Leave'::text, 'Sick Leave'::text, 'Unpaid Leave'::text
    ])),
  CONSTRAINT leave_entitlement_policy_entitled_days_nonneg
    CHECK (entitled_days >= 0),
  CONSTRAINT leave_entitlement_policy_key UNIQUE
    (tenant_id, "position", employment_type, leave_type)
);

COMMENT ON TABLE public.leave_entitlement_policy IS
  'Default leave entitlements by Position × Employment Type × Leave Type. '
  'Applied only when creating new employee_leave_balances rows (forward-only). '
  'Missing policy => Annual Leave 15, Sick/Unpaid 0.';

CREATE INDEX IF NOT EXISTS leave_entitlement_policy_tenant_lookup_idx
  ON public.leave_entitlement_policy (tenant_id, "position", employment_type);

DROP TRIGGER IF EXISTS trg_leave_entitlement_policy_enforce_tenant_id
  ON public.leave_entitlement_policy;
CREATE TRIGGER trg_leave_entitlement_policy_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.leave_entitlement_policy
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.leave_entitlement_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_entitlement_policy_tenant_select
  ON public.leave_entitlement_policy;
CREATE POLICY leave_entitlement_policy_tenant_select
  ON public.leave_entitlement_policy
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leave_entitlement_policy_tenant_insert
  ON public.leave_entitlement_policy;
CREATE POLICY leave_entitlement_policy_tenant_insert
  ON public.leave_entitlement_policy
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leave_entitlement_policy_tenant_update
  ON public.leave_entitlement_policy;
CREATE POLICY leave_entitlement_policy_tenant_update
  ON public.leave_entitlement_policy
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leave_entitlement_policy_tenant_delete
  ON public.leave_entitlement_policy;
CREATE POLICY leave_entitlement_policy_tenant_delete
  ON public.leave_entitlement_policy
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leave_entitlement_policy_super_admin_full_access
  ON public.leave_entitlement_policy;
CREATE POLICY leave_entitlement_policy_super_admin_full_access
  ON public.leave_entitlement_policy
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_entitlement_policy TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leave_entitlement_policy TO service_role;

-- ---------------------------------------------------------------------------
-- 2. resolve_leave_entitlement (SQL) — policy first, then Annual=15 / else 0
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_leave_entitlement(
  p_tenant_id uuid,
  p_position text,
  p_employment_type text,
  p_leave_type text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_days numeric(8, 2);
  v_leave text := btrim(COALESCE(p_leave_type, ''));
  v_pos text := btrim(COALESCE(p_position, ''));
  v_emp text := btrim(COALESCE(p_employment_type, ''));
BEGIN
  IF p_tenant_id IS NOT NULL AND v_pos <> '' AND v_emp <> '' AND v_leave <> '' THEN
    SELECT lep.entitled_days
    INTO v_days
    FROM public.leave_entitlement_policy lep
    WHERE lep.tenant_id = p_tenant_id
      AND lep."position" = v_pos
      AND lep.employment_type = v_emp
      AND lep.leave_type = v_leave
    LIMIT 1;

    IF FOUND THEN
      RETURN COALESCE(v_days, 0);
    END IF;
  END IF;

  -- Fallback matches current product behavior (script 55 / seed):
  -- Annual Leave 15; Sick Leave / Unpaid Leave 0.
  IF v_leave = 'Annual Leave' THEN
    RETURN 15;
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.resolve_leave_entitlement(uuid, text, text, text) IS
  'Leave entitlement days from leave_entitlement_policy, else Annual=15 / Sick=0 / Unpaid=0.';

GRANT EXECUTE ON FUNCTION public.resolve_leave_entitlement(uuid, text, text, text)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. approve_leave_request — skeleton uses resolve_leave_entitlement (forward-only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_leave_request(
  p_request_id UUID,
  p_decision_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request leave_requests%ROWTYPE;
  v_year INTEGER;
  v_employee employees%ROWTYPE;
  v_leave_type_name text;
  v_entitled numeric(8, 2);
BEGIN
  SELECT *
  INTO v_request
  FROM leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request % not found', p_request_id;
  END IF;

  IF v_request.status <> 'Pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be approved';
  END IF;

  IF NOT is_assigned_leave_approver(v_request.approver_user_account_id)
     AND NOT can_manage_leave_balances() THEN
    RAISE EXCEPTION 'You are not authorized to approve this leave request';
  END IF;

  v_year := EXTRACT(YEAR FROM v_request.start_date)::INTEGER;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = v_request.employee_id;

  SELECT lt.type_name
  INTO v_leave_type_name
  FROM leave_types lt
  WHERE lt.id = v_request.leave_type_id;

  v_entitled := public.resolve_leave_entitlement(
    COALESCE(v_request.tenant_id, v_employee.tenant_id),
    v_employee."position",
    v_employee.employment_type,
    v_leave_type_name
  );

  -- Only inserts when missing; never updates entitled_days on existing rows.
  INSERT INTO employee_leave_balances (
    tenant_id,
    employee_id,
    leave_type_id,
    year,
    entitled_days,
    days_used
  )
  VALUES (
    COALESCE(v_request.tenant_id, v_employee.tenant_id),
    v_request.employee_id,
    v_request.leave_type_id,
    v_year,
    v_entitled,
    0
  )
  ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

  UPDATE employee_leave_balances
  SET
    days_used = days_used + v_request.days_requested,
    updated_at = now()
  WHERE employee_id = v_request.employee_id
    AND leave_type_id = v_request.leave_type_id
    AND year = v_year;

  UPDATE leave_requests
  SET
    status = 'Approved',
    decided_at = now(),
    decision_notes = NULLIF(TRIM(p_decision_notes), '')
  WHERE id = p_request_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_employee_leave_balances_for_year
--    Shared forward-only path for on-hire and new-year ensure (no separate
--    leave-year rollover job exists today). Inserts missing rows only;
--    never updates entitled_days on existing employee_leave_balances.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_employee_leave_balances_for_year(
  p_employee_id text,
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_employee employees%ROWTYPE;
  v_lt RECORD;
  v_entitled numeric(8, 2);
  v_inserted integer := 0;
  v_rowcount integer;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  ) THEN
    RAISE EXCEPTION 'Not authorized to create employee leave balances';
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee % not found', p_employee_id;
  END IF;

  IF v_employee.tenant_id IS NULL OR NOT tenant_matches(v_employee.tenant_id) THEN
    RAISE EXCEPTION 'Tenant mismatch for employee %', p_employee_id;
  END IF;

  FOR v_lt IN
    SELECT lt.id, lt.type_name
    FROM leave_types lt
    WHERE lt.type_name = ANY (ARRAY[
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
$$;

COMMENT ON FUNCTION public.create_employee_leave_balances_for_year(text, integer) IS
  'Forward-only: create missing employee_leave_balances for a year using '
  'resolve_leave_entitlement. Used on hire and for new-year ensure. '
  'Never updates existing entitled_days.';

GRANT EXECUTE ON FUNCTION public.create_employee_leave_balances_for_year(text, integer)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
