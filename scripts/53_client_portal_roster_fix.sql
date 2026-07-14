-- Script 53: Client portal staffing coverage — expose facility projects + roster staff.
--
-- Root cause: Admin Duty Roster matches staff via legacy facility projects (PRJ09–PRJ12)
-- whose project_name equals the site name. Client projects RLS only exposed the parent
-- contract project linked by sites.project_id (PRJ01), so buildDutyRosterViewModel saw
-- required_staff from sites but totalStaff = 0.
--
-- Fix: extend client SELECT on projects and employees for roster visibility only.

BEGIN;

CREATE OR REPLACE FUNCTION client_can_view_roster_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'client'::app_role THEN
      EXISTS (
        SELECT 1
        FROM sites s
        WHERE s.client_id = current_user_client_id()
          AND s.project_id = p_project_id
      )
      OR EXISTS (
        SELECT 1
        FROM sites s
        JOIN projects p ON p.id = p_project_id
        WHERE s.client_id = current_user_client_id()
          AND p.required_staff IS NOT NULL
          AND lower(trim(p.project_name)) = lower(trim(s.site_name))
      )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION client_can_view_roster_employee(
  p_assigned_site_id text,
  p_contract_project text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'client'::app_role THEN
      can_access_client_site(p_assigned_site_id)
      OR (
        p_contract_project IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM sites s
          LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.client_id = current_user_client_id()
            AND (
              p_contract_project = p.project_code
              OR EXISTS (
                SELECT 1
                FROM projects pr
                WHERE pr.project_code = p_contract_project
                  AND pr.required_staff IS NOT NULL
                  AND lower(trim(pr.project_name)) = lower(trim(s.site_name))
              )
            )
        )
      )
    ELSE false
  END;
$$;

GRANT EXECUTE ON FUNCTION client_can_view_roster_project(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION client_can_view_roster_employee(text, text) TO authenticated, service_role;

DROP POLICY IF EXISTS projects_client_select ON projects;
CREATE POLICY projects_client_select
  ON projects
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR current_user_role() IN (
      'finance'::app_role,
      'hr'::app_role,
      'operations_manager'::app_role,
      'supervisor'::app_role
    )
    OR client_can_view_roster_project(id)
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
    OR client_can_view_roster_employee(assigned_site_id, contract_project)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
