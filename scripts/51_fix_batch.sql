-- Script 51: Fix batch — display name support, self-service payslip/roster, roster visibility.
-- 1. Employees: every user can read their own employee row (header, payslip, My Roster).
-- 2. Roster history SELECT: supervisor/hr/operations see full roster; employees see own row.
--    INSERT/UPDATE/DELETE unchanged — supervisor still edits only assigned-site employees.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Own employee record (header, payslip, My Roster)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS employees_rbac_select ON employees;
CREATE POLICY employees_rbac_select
  ON employees
  FOR SELECT
  TO authenticated
  USING (
    can_access_employee_record(assigned_site_id)
    OR employee_id = current_user_employee_id()
  );

-- ---------------------------------------------------------------------------
-- 2. Roster history — view-all for supervisor/hr/ops; edit still site-scoped for supervisor
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS roster_history_rbac_select ON roster_history;
CREATE POLICY roster_history_rbac_select
  ON roster_history
  FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'hr'::app_role
    )
    OR current_user_role() = 'supervisor'::app_role
    OR employee_id = current_user_employee_id()
  );

-- INSERT/UPDATE/DELETE policies unchanged from script 48 (supervisor site-scoped writes).

NOTIFY pgrst, 'reload schema';

COMMIT;
