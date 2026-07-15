-- Script 56: Fix supervisor Employees directory scoping (revert script 52 employees bypass).
--
-- Problem: script 52 added OR current_user_role() = 'supervisor' to employees_rbac_select,
-- opening the full Employees directory while only Duty Roster needs company-wide staff display.
--
-- Fix:
--   1. Restore employees_rbac_select to site-scoped access (script 51 policy).
--   2. Keep sites_rbac_select supervisor company-wide view (script 52 — needed for Duty Roster).
--   3. Re-affirm roster_history_rbac_select supervisor company-wide view (script 51).
--   4. Add SECURITY DEFINER get_duty_roster_employee_display() for roster UI name/assignment
--      fields without opening the employees table to supervisor SELECT.
--   5. Seed minimal roster_history rows across multiple sites for regression testing.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Restore Employees directory RLS (site-scoped for supervisor)
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

-- sites_rbac_select from script 52 is unchanged — supervisor still sees all sites for Duty Roster.

-- ---------------------------------------------------------------------------
-- 2. Re-affirm roster_history company-wide SELECT for supervisor
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

-- INSERT/UPDATE/DELETE on roster_history remain site-scoped for supervisor (script 48).

-- ---------------------------------------------------------------------------
-- 3. Duty Roster display helper — limited fields, company-wide for roster roles only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION can_view_duty_roster_company_wide()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'operations_manager'::app_role,
    'hr'::app_role,
    'supervisor'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION get_duty_roster_employee_display()
RETURNS TABLE (
  employee_id text,
  staff_id text,
  full_name text,
  "position" text,
  shift text,
  contract_project text,
  employment_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.employee_id,
    e.staff_id,
    e.full_name,
    e."position",
    e.shift,
    e.contract_project,
    e.employment_status
  FROM employees e
  WHERE
    can_view_duty_roster_company_wide()
    OR can_access_employee_record(e.assigned_site_id)
    OR e.employee_id = current_user_employee_id()
  ORDER BY e.staff_id ASC;
$$;

GRANT EXECUTE ON FUNCTION can_view_duty_roster_company_wide() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_duty_roster_employee_display() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. (Removed) Seed roster_history regression rows
--    One-time RBAC Phase 5 seeds (R9001–R9003) were cleaned from production.
--    Do not re-seed here — live roster_history should only contain real rotations.
-- ---------------------------------------------------------------------------

NOTIFY pgrst, 'reload schema';

COMMIT;
