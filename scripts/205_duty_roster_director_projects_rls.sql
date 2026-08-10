-- Script 205: Allow director to SELECT projects (duty roster + operations views).
-- Root cause: script 204 updated roster helpers/policies but omitted projects_client_select.
-- Director could load employees (get_duty_roster_employee_display) and sites, but projects
-- returned 0 rows, breaking client project-code resolution, staff counts, and rotation history.

BEGIN;

DROP POLICY IF EXISTS projects_client_select ON projects;
CREATE POLICY projects_client_select
  ON projects
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN (
        'finance'::app_role,
        'hr'::app_role,
        'operations_manager'::app_role,
        'supervisor'::app_role,
        'director'::app_role
      )
      OR EXISTS (
        SELECT 1
        FROM sites s
        WHERE s.project_id = projects.id
          AND tenant_matches(s.tenant_id)
          AND s.client_id = current_user_client_id()
          AND current_user_role() = 'client'::app_role
      )
    )
    AND tenant_has_feature(tenant_id, 'operations')
  );

COMMIT;
