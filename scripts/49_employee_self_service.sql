-- Script 49: RBAC Phase 3 — Employee self-service portal, leave balances,
-- configurable approver workflow, and row-level security for own-data access.
--
-- NOTE FOR DAVID:
--   Annual Leave default_annual_entitlement is NULL pending confirmation of
--   the standard entitlement under the Ghana Labour Act.
--   Leave requests that exceed balance are allowed with exceeds_balance = true
--   (warn-but-allow default).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Leave types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_name TEXT NOT NULL UNIQUE,
  default_annual_entitlement NUMERIC(8, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN leave_types.default_annual_entitlement IS
  'Days per year. NULL on Annual Leave until David confirms Ghana Labour Act entitlement.';

INSERT INTO leave_types (type_name, default_annual_entitlement)
VALUES
  ('Annual Leave', NULL),
  ('Sick Leave', NULL),
  ('Unpaid Leave', 0)
ON CONFLICT (type_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Employee leave balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES employees (employee_id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types (id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  entitled_days NUMERIC(8, 2) NOT NULL DEFAULT 0,
  days_used NUMERIC(8, 2) NOT NULL DEFAULT 0,
  days_remaining NUMERIC(8, 2) GENERATED ALWAYS AS (entitled_days - days_used) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, leave_type_id, year)
);

CREATE INDEX IF NOT EXISTS idx_employee_leave_balances_employee_year
  ON employee_leave_balances (employee_id, year);

-- ---------------------------------------------------------------------------
-- 3. Leave request status + approver config + requests
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE leave_request_status AS ENUM (
    'Pending',
    'Approved',
    'Rejected',
    'Cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS leave_approver_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approver_user_account_id UUID NOT NULL REFERENCES user_accounts (auth_uid) ON DELETE RESTRICT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_approver_config_effective_from
  ON leave_approver_config (effective_from DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL REFERENCES employees (employee_id) ON DELETE CASCADE,
  leave_type_id UUID NOT NULL REFERENCES leave_types (id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_requested NUMERIC(8, 2) NOT NULL,
  reason TEXT,
  status leave_request_status NOT NULL DEFAULT 'Pending',
  approver_user_account_id UUID NOT NULL REFERENCES user_accounts (auth_uid) ON DELETE RESTRICT,
  exceeds_balance BOOLEAN NOT NULL DEFAULT false,
  decided_at TIMESTAMPTZ,
  decision_notes TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  CHECK (days_requested > 0)
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_id
  ON leave_requests (employee_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_leave_requests_approver_status
  ON leave_requests (approver_user_account_id, status);

-- ---------------------------------------------------------------------------
-- 4. Helper functions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_employee_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION current_user_staff_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.staff_id
  FROM user_accounts ua
  JOIN employees e ON e.employee_id = ua.employee_id
  WHERE ua.auth_uid = auth.uid()
    AND ua.is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION can_access_hr_payroll_data()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_leave_balances()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'hr'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION current_leave_approver_auth_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT approver_user_account_id
  FROM leave_approver_config
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION is_current_leave_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = current_leave_approver_auth_uid();
$$;

CREATE OR REPLACE FUNCTION is_assigned_leave_approver(p_approver_auth_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() = p_approver_auth_uid;
$$;

CREATE OR REPLACE FUNCTION calculate_leave_days(p_start_date date, p_end_date date)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN 0::numeric
    ELSE (p_end_date - p_start_date + 1)::numeric
  END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Leave workflow RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_leave_request(
  p_leave_type_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID
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
  IF current_user_role() <> 'employee'::app_role THEN
    RAISE EXCEPTION 'Only employee-role users can submit leave requests';
  END IF;

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

CREATE OR REPLACE FUNCTION approve_leave_request(
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

  INSERT INTO employee_leave_balances (
    employee_id,
    leave_type_id,
    year,
    entitled_days,
    days_used
  )
  VALUES (
    v_request.employee_id,
    v_request.leave_type_id,
    v_year,
    0,
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

CREATE OR REPLACE FUNCTION reject_leave_request(
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
    RAISE EXCEPTION 'Only pending leave requests can be rejected';
  END IF;

  IF NOT is_assigned_leave_approver(v_request.approver_user_account_id)
     AND NOT can_manage_leave_balances() THEN
    RAISE EXCEPTION 'You are not authorized to reject this leave request';
  END IF;

  UPDATE leave_requests
  SET
    status = 'Rejected',
    decided_at = now(),
    decision_notes = NULLIF(TRIM(p_decision_notes), '')
  WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION cancel_leave_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request leave_requests%ROWTYPE;
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
    RAISE EXCEPTION 'Only pending leave requests can be cancelled';
  END IF;

  IF v_request.employee_id <> current_user_employee_id() THEN
    RAISE EXCEPTION 'You can only cancel your own leave requests';
  END IF;

  UPDATE leave_requests
  SET
    status = 'Cancelled',
    decided_at = now()
  WHERE id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION change_leave_approver(
  p_approver_auth_uid UUID,
  p_effective_from DATE DEFAULT CURRENT_DATE,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only administrators can change the leave approver';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_accounts WHERE auth_uid = p_approver_auth_uid AND is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Selected approver user account does not exist or is inactive';
  END IF;

  INSERT INTO leave_approver_config (
    approver_user_account_id,
    effective_from,
    notes
  )
  VALUES (
    p_approver_auth_uid,
    COALESCE(p_effective_from, CURRENT_DATE),
    NULLIF(TRIM(p_notes), '')
  )
  RETURNING id INTO v_config_id;

  RETURN v_config_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Seed approver (Gifty / EMP0002) and initial balances for current year
-- ---------------------------------------------------------------------------
INSERT INTO leave_approver_config (approver_user_account_id, effective_from, notes)
SELECT
  ua.auth_uid,
  CURRENT_DATE,
  'Seed: Administrative Director (EMP0002) — confirm with David/Gifty'
FROM user_accounts ua
WHERE ua.employee_id = 'EMP0002'
  AND ua.is_active IS NOT FALSE
  AND NOT EXISTS (SELECT 1 FROM leave_approver_config)
LIMIT 1;

INSERT INTO employee_leave_balances (employee_id, leave_type_id, year, entitled_days, days_used)
SELECT
  e.employee_id,
  lt.id,
  EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
  COALESCE(lt.default_annual_entitlement, 0),
  0
FROM employees e
CROSS JOIN leave_types lt
ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON leave_types TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_leave_balances TO authenticated, service_role;
GRANT SELECT, INSERT ON leave_approver_config TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON leave_requests TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION current_user_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_user_staff_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_hr_payroll_data() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_manage_leave_balances() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_leave_approver_auth_uid() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_current_leave_approver() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_assigned_leave_approver(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_leave_days(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION submit_leave_request(uuid, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION approve_leave_request(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reject_leave_request(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION cancel_leave_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION change_leave_approver(uuid, date, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_approver_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_types_read_authenticated ON leave_types;
CREATE POLICY leave_types_read_authenticated
  ON leave_types
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS employee_leave_balances_select ON employee_leave_balances;
CREATE POLICY employee_leave_balances_select
  ON employee_leave_balances
  FOR SELECT
  TO authenticated
  USING (
    can_manage_leave_balances()
    OR employee_id = current_user_employee_id()
  );

DROP POLICY IF EXISTS employee_leave_balances_write ON employee_leave_balances;
CREATE POLICY employee_leave_balances_write
  ON employee_leave_balances
  FOR ALL
  TO authenticated
  USING (can_manage_leave_balances())
  WITH CHECK (can_manage_leave_balances());

DROP POLICY IF EXISTS leave_approver_config_select ON leave_approver_config;
CREATE POLICY leave_approver_config_select
  ON leave_approver_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS leave_approver_config_insert ON leave_approver_config;
CREATE POLICY leave_approver_config_insert
  ON leave_approver_config
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS leave_requests_select ON leave_requests;
CREATE POLICY leave_requests_select
  ON leave_requests
  FOR SELECT
  TO authenticated
  USING (
    can_manage_leave_balances()
    OR employee_id = current_user_employee_id()
    OR is_assigned_leave_approver(approver_user_account_id)
  );

DROP POLICY IF EXISTS leave_requests_insert ON leave_requests;
CREATE POLICY leave_requests_insert
  ON leave_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_role() = 'employee'::app_role
    AND employee_id = current_user_employee_id()
  );

DROP POLICY IF EXISTS leave_requests_update ON leave_requests;
CREATE POLICY leave_requests_update
  ON leave_requests
  FOR UPDATE
  TO authenticated
  USING (
    employee_id = current_user_employee_id()
    OR is_assigned_leave_approver(approver_user_account_id)
    OR can_manage_leave_balances()
  )
  WITH CHECK (
    employee_id = current_user_employee_id()
    OR is_assigned_leave_approver(approver_user_account_id)
    OR can_manage_leave_balances()
  );

-- Payroll history + attendance: employee sees own data; HR roles retain full access
ALTER TABLE payroll_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_history_self_service_select ON payroll_history;
CREATE POLICY payroll_history_self_service_select
  ON payroll_history
  FOR SELECT
  TO authenticated
  USING (
    can_access_hr_payroll_data()
    OR employee_id = current_user_employee_id()
  );

DROP POLICY IF EXISTS payroll_history_hr_write ON payroll_history;
CREATE POLICY payroll_history_hr_write
  ON payroll_history
  FOR ALL
  TO authenticated
  USING (can_access_hr_payroll_data())
  WITH CHECK (can_access_hr_payroll_data());

ALTER TABLE attendance_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_register_self_service_select ON attendance_register;
CREATE POLICY attendance_register_self_service_select
  ON attendance_register
  FOR SELECT
  TO authenticated
  USING (
    can_access_hr_payroll_data()
    OR staff_id = current_user_staff_id()
  );

DROP POLICY IF EXISTS attendance_register_hr_write ON attendance_register;
CREATE POLICY attendance_register_hr_write
  ON attendance_register
  FOR ALL
  TO authenticated
  USING (can_access_hr_payroll_data())
  WITH CHECK (can_access_hr_payroll_data());

NOTIFY pgrst, 'reload schema';

COMMIT;
