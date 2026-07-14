-- Script 48: RBAC Phase 2 — role helpers + RLS for Operations and Employees.
-- Page-level guards are enforced in the app; this script enforces supervisor
-- site scoping at the database level.

-- ---------------------------------------------------------------------------
-- 0. Replace legacy helpers that may use a different return type/signature
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS current_user_role() CASCADE;

-- ---------------------------------------------------------------------------
-- 1. Role helper functions (used by RLS policies and script 47)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() = 'super_admin'::app_role;
$$;

CREATE OR REPLACE FUNCTION current_user_supervisor_site_codes()
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT site_code
  FROM user_account_supervisor_sites
  WHERE auth_uid = auth.uid();
$$;

CREATE OR REPLACE FUNCTION can_access_operations_site(p_site_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN EXISTS (
      SELECT 1
      FROM user_account_supervisor_sites
      WHERE auth_uid = auth.uid()
        AND site_code = p_site_code
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION can_access_employee_record(p_assigned_site_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'hr'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN
      p_assigned_site_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM user_account_supervisor_sites
        WHERE auth_uid = auth.uid()
          AND site_code = p_assigned_site_id
      )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION can_write_employee_records()
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

GRANT EXECUTE ON FUNCTION current_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION is_super_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION current_user_supervisor_site_codes() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_operations_site(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_employee_record(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_write_employee_records() TO authenticated, service_role;

-- Recreate supervisor site policy dropped by current_user_role() CASCADE (script 47)
DROP POLICY IF EXISTS supervisor_sites_super_admin_all ON user_account_supervisor_sites;
CREATE POLICY supervisor_sites_super_admin_all
  ON user_account_supervisor_sites
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ---------------------------------------------------------------------------
-- 2. Employees RLS
-- ---------------------------------------------------------------------------
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employees_rbac_select ON employees;
CREATE POLICY employees_rbac_select
  ON employees
  FOR SELECT
  TO authenticated
  USING (can_access_employee_record(assigned_site_id));

DROP POLICY IF EXISTS employees_rbac_insert ON employees;
CREATE POLICY employees_rbac_insert
  ON employees
  FOR INSERT
  TO authenticated
  WITH CHECK (can_write_employee_records());

DROP POLICY IF EXISTS employees_rbac_update ON employees;
CREATE POLICY employees_rbac_update
  ON employees
  FOR UPDATE
  TO authenticated
  USING (can_write_employee_records())
  WITH CHECK (can_write_employee_records());

DROP POLICY IF EXISTS employees_rbac_delete ON employees;
CREATE POLICY employees_rbac_delete
  ON employees
  FOR DELETE
  TO authenticated
  USING (can_write_employee_records());

-- ---------------------------------------------------------------------------
-- 3. Sites RLS (supervisors see only assigned sites)
-- ---------------------------------------------------------------------------
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_rbac_select ON sites;
CREATE POLICY sites_rbac_select
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND site_code IN (SELECT current_user_supervisor_site_codes())
    )
    OR current_user_role() IN ('finance'::app_role, 'hr'::app_role)
  );

DROP POLICY IF EXISTS sites_rbac_write ON sites;
CREATE POLICY sites_rbac_write
  ON sites
  FOR ALL
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  )
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 4. Operations tables with direct site_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'work_orders',
    'inspection_summary',
    'failed_inspections',
    'complaint_register',
    'incident_register'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_select ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_rbac_select ON %I FOR SELECT TO authenticated USING (can_access_operations_site(site_id))',
      table_name,
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_insert ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_rbac_insert ON %I FOR INSERT TO authenticated WITH CHECK (can_access_operations_site(site_id))',
      table_name,
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_update ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_rbac_update ON %I FOR UPDATE TO authenticated USING (can_access_operations_site(site_id)) WITH CHECK (can_access_operations_site(site_id))',
      table_name,
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_delete ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_rbac_delete ON %I FOR DELETE TO authenticated USING (can_access_operations_site(site_id))',
      table_name,
      table_name
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Corrective actions (site derived from related work order / issue)
-- ---------------------------------------------------------------------------
ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS corrective_actions_rbac_select ON corrective_actions;
CREATE POLICY corrective_actions_rbac_select
  ON corrective_actions
  FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND (
        (
          related_work_order IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM work_orders wo
            WHERE wo.work_order_no = corrective_actions.related_work_order
              AND can_access_operations_site(wo.site_id)
          )
        )
        OR (
          related_issue_no IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM failed_inspections fi
            WHERE fi.issue_no = corrective_actions.related_issue_no
              AND can_access_operations_site(fi.site_id)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS corrective_actions_rbac_insert ON corrective_actions;
CREATE POLICY corrective_actions_rbac_insert
  ON corrective_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND (
        (
          related_work_order IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM work_orders wo
            WHERE wo.work_order_no = corrective_actions.related_work_order
              AND can_access_operations_site(wo.site_id)
          )
        )
        OR (
          related_issue_no IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM failed_inspections fi
            WHERE fi.issue_no = corrective_actions.related_issue_no
              AND can_access_operations_site(fi.site_id)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS corrective_actions_rbac_update ON corrective_actions;
CREATE POLICY corrective_actions_rbac_update
  ON corrective_actions
  FOR UPDATE
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND (
        (
          related_work_order IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM work_orders wo
            WHERE wo.work_order_no = corrective_actions.related_work_order
              AND can_access_operations_site(wo.site_id)
          )
        )
        OR (
          related_issue_no IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM failed_inspections fi
            WHERE fi.issue_no = corrective_actions.related_issue_no
              AND can_access_operations_site(fi.site_id)
          )
        )
      )
    )
  )
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND (
        (
          related_work_order IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM work_orders wo
            WHERE wo.work_order_no = corrective_actions.related_work_order
              AND can_access_operations_site(wo.site_id)
          )
        )
        OR (
          related_issue_no IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM failed_inspections fi
            WHERE fi.issue_no = corrective_actions.related_issue_no
              AND can_access_operations_site(fi.site_id)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS corrective_actions_rbac_delete ON corrective_actions;
CREATE POLICY corrective_actions_rbac_delete
  ON corrective_actions
  FOR DELETE
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND (
        (
          related_work_order IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM work_orders wo
            WHERE wo.work_order_no = corrective_actions.related_work_order
              AND can_access_operations_site(wo.site_id)
          )
        )
        OR (
          related_issue_no IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM failed_inspections fi
            WHERE fi.issue_no = corrective_actions.related_issue_no
              AND can_access_operations_site(fi.site_id)
          )
        )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Roster history (scoped via employee assigned site)
-- ---------------------------------------------------------------------------
ALTER TABLE roster_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_history_rbac_select ON roster_history;
CREATE POLICY roster_history_rbac_select
  ON roster_history
  FOR SELECT
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND employee_id IS NOT NULL
      AND can_access_employee_record(
        (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id)
      )
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_insert ON roster_history;
CREATE POLICY roster_history_rbac_insert
  ON roster_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND employee_id IS NOT NULL
      AND can_access_employee_record(
        (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id)
      )
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_update ON roster_history;
CREATE POLICY roster_history_rbac_update
  ON roster_history
  FOR UPDATE
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND employee_id IS NOT NULL
      AND can_access_employee_record(
        (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id)
      )
    )
  )
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
    OR (
      current_user_role() = 'supervisor'::app_role
      AND employee_id IS NOT NULL
      AND can_access_employee_record(
        (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id)
      )
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_delete ON roster_history;
CREATE POLICY roster_history_rbac_delete
  ON roster_history
  FOR DELETE
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  );

NOTIFY pgrst, 'reload schema';
