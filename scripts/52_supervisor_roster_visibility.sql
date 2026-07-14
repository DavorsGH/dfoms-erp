-- Script 52: Supervisor full Duty Roster visibility (view-all, edit still site-scoped).
--
-- Investigation: script 51 DID apply — roster_history_rbac_select already grants
-- supervisor unrestricted SELECT. The Duty Roster UI was still empty beyond assigned
-- sites because sites_rbac_select and employees_rbac_select remain site-scoped.
--
-- This script:
--   1. Grants supervisor full SELECT on sites (all facilities company-wide).
--   2. Grants supervisor full SELECT on employees (needed to populate roster rows).
--   INSERT/UPDATE/DELETE on roster_history remain site-scoped via script 48 policies.
--   Employees directory write access unchanged; work_orders etc. unchanged.

BEGIN;

DROP POLICY IF EXISTS sites_rbac_select ON sites;
CREATE POLICY sites_rbac_select
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR current_user_role() = 'supervisor'::app_role
    OR current_user_role() IN ('finance'::app_role, 'hr'::app_role)
    OR (
      current_user_role() = 'client'::app_role
      AND client_id = current_user_client_id()
    )
  );

DROP POLICY IF EXISTS employees_rbac_select ON employees;
CREATE POLICY employees_rbac_select
  ON employees
  FOR SELECT
  TO authenticated
  USING (
    can_access_employee_record(assigned_site_id)
    OR employee_id = current_user_employee_id()
    OR current_user_role() = 'supervisor'::app_role
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
