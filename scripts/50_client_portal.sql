-- Script 50: RBAC Phase 4 — Client portal read-only access scoped by client_id.
-- Enforces database-level RLS for income_register and operations data.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Client identity helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_client_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_id
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION can_access_finance_income_data()
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

CREATE OR REPLACE FUNCTION can_access_client_record(p_client_id text)
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
    WHEN 'supervisor'::app_role THEN true
    WHEN 'client'::app_role THEN
      p_client_id IS NOT NULL
      AND p_client_id = current_user_client_id()
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION can_access_client_site(p_site_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM sites s
    WHERE s.site_code = p_site_code
      AND can_access_client_record(s.client_id)
  );
$$;

-- Extend operations site access for client-role portal (read via site ownership)
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
    WHEN 'client'::app_role THEN can_access_client_site(p_site_code)
    ELSE false
  END;
$$;

-- Extend employee visibility for client staffing sections in service reports
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
    WHEN 'client'::app_role THEN can_access_client_site(p_assigned_site_id)
    ELSE false
  END;
$$;

GRANT EXECUTE ON FUNCTION current_user_client_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_finance_income_data() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_client_record(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION can_access_client_site(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Clients table — client users see only their own record
-- ---------------------------------------------------------------------------
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_rbac_select ON clients;
CREATE POLICY clients_rbac_select
  ON clients
  FOR SELECT
  TO authenticated
  USING (can_access_client_record(client_id));

DROP POLICY IF EXISTS clients_rbac_write ON clients;
CREATE POLICY clients_rbac_write
  ON clients
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- ---------------------------------------------------------------------------
-- 3. Income register — client sees own service invoices only (read-only)
-- ---------------------------------------------------------------------------
ALTER TABLE income_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS income_register_select ON income_register;
CREATE POLICY income_register_select
  ON income_register
  FOR SELECT
  TO authenticated
  USING (
    can_access_finance_income_data()
    OR (
      current_user_role() = 'client'::app_role
      AND client_id = current_user_client_id()
      AND entry_type = 'service'::income_entry_type
    )
  );

DROP POLICY IF EXISTS income_register_write ON income_register;
CREATE POLICY income_register_write
  ON income_register
  FOR ALL
  TO authenticated
  USING (can_access_finance_income_data())
  WITH CHECK (can_access_finance_income_data());

-- ---------------------------------------------------------------------------
-- 4. Sites — client sees only their own sites
-- ---------------------------------------------------------------------------
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
    OR (
      current_user_role() = 'client'::app_role
      AND client_id = current_user_client_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Roster config — client reads own client config for service reports
-- ---------------------------------------------------------------------------
ALTER TABLE roster_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roster_config_client_select ON roster_config;
CREATE POLICY roster_config_client_select
  ON roster_config
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    OR current_user_role() IN ('operations_manager'::app_role, 'supervisor'::app_role)
    OR can_access_client_record(client_id)
  );

DROP POLICY IF EXISTS roster_config_ops_write ON roster_config;
CREATE POLICY roster_config_ops_write
  ON roster_config
  FOR ALL
  TO authenticated
  USING (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  )
  WITH CHECK (
    current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 6. Projects — client reads projects linked to their sites
-- ---------------------------------------------------------------------------
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

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
    OR EXISTS (
      SELECT 1
      FROM sites s
      WHERE s.project_id = projects.id
        AND s.client_id = current_user_client_id()
        AND current_user_role() = 'client'::app_role
    )
  );

DROP POLICY IF EXISTS projects_admin_write ON projects;
CREATE POLICY projects_admin_write
  ON projects
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;
