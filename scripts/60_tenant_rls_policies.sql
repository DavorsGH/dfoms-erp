-- Script 60: Phase 1 — Tenant RLS policies.
-- Apply ONLY after script 59 is verified on staging/local.
--
-- APPROACH (see docs/phase1-query-audit.md for application follow-up):
--   Tenant context comes from user_accounts.tenant_id resolved via auth.uid().
--   Helper: current_user_tenant_id() — same SECURITY DEFINER pattern as current_user_role().
--   We do NOT use JWT user_metadata (user-editable). app_metadata JWT claims are deferred;
--   the existing bridge table is authoritative and matches scripts 47–56.
--
--   Every policy adds: tenant_id = (SELECT current_user_tenant_id())
--   Existing RBAC predicates (role, site, client scoping) are preserved with AND.
--
--   Order per table: DROP old policies → CREATE new policies → ENABLE ROW LEVEL SECURITY.
--   Tables that already had RLS enabled keep it; tables without RLS are enabled here.
--
--   service_role bypasses RLS (admin API routes). Authenticated publishable-key clients
--   are tenant-scoped.
--
-- Rollout tip: run section-by-section in SQL editor; verify one module before continuing.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Tenant helper (canonical definition; replaces stub from script 59)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM user_accounts
  WHERE auth_uid = auth.uid()
    AND is_active IS NOT FALSE;
$$;

CREATE OR REPLACE FUNCTION tenant_matches(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND p_tenant_id = (SELECT current_user_tenant_id());
$$;

GRANT EXECUTE ON FUNCTION current_user_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION tenant_matches(uuid) TO authenticated, service_role;

-- Patch duty-roster helper to respect tenant boundary
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
  WHERE tenant_matches(e.tenant_id)
    AND (
      can_view_duty_roster_company_wide()
      OR can_access_employee_record(e.assigned_site_id)
      OR e.employee_id = current_user_employee_id()
    )
  ORDER BY e.staff_id ASC;
$$;

-- ---------------------------------------------------------------------------
-- 1. tenants — users see only their own tenant row
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenants_select_own ON tenants;
CREATE POLICY tenants_select_own
  ON tenants
  FOR SELECT
  TO authenticated
  USING (id = (SELECT current_user_tenant_id()));

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. user_accounts — own row + super_admin sees all accounts in tenant
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS user_accounts_select ON user_accounts;
CREATE POLICY user_accounts_select
  ON user_accounts
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      auth_uid = auth.uid()
      OR is_super_admin()
    )
  );

DROP POLICY IF EXISTS user_accounts_write ON user_accounts;
CREATE POLICY user_accounts_write
  ON user_accounts
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

ALTER TABLE user_accounts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. roles + user_account_supervisor_sites (script 47)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS roles_read_authenticated ON roles;
CREATE POLICY roles_read_authenticated
  ON roles
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS supervisor_sites_super_admin_all ON user_account_supervisor_sites;
CREATE POLICY supervisor_sites_super_admin_all
  ON user_account_supervisor_sites
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account_supervisor_sites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 4. employees (script 48 + 56)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS employees_rbac_select ON employees;
CREATE POLICY employees_rbac_select
  ON employees
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_access_employee_record(assigned_site_id)
      OR employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS employees_rbac_insert ON employees;
CREATE POLICY employees_rbac_insert
  ON employees
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id) AND can_write_employee_records());

DROP POLICY IF EXISTS employees_rbac_update ON employees;
CREATE POLICY employees_rbac_update
  ON employees
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_write_employee_records())
  WITH CHECK (tenant_matches(tenant_id) AND can_write_employee_records());

DROP POLICY IF EXISTS employees_rbac_delete ON employees;
CREATE POLICY employees_rbac_delete
  ON employees
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_write_employee_records());

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. sites (script 48 + 50 client read)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS sites_rbac_select ON sites;
CREATE POLICY sites_rbac_select
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
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
    )
  );

DROP POLICY IF EXISTS sites_rbac_write ON sites;
CREATE POLICY sites_rbac_write
  ON sites
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  );

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 6. Operations tables with direct site_id (script 48 loop)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'work_orders',
    'inspection_summary',
    'failed_inspections',
    'complaint_register',
    'incident_register'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_select ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_rbac_select ON %I FOR SELECT TO authenticated
      USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_insert ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_rbac_insert ON %I FOR INSERT TO authenticated
      WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_update ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_rbac_update ON %I FOR UPDATE TO authenticated
      USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id))
      WITH CHECK (tenant_matches(tenant_id) AND can_access_operations_site(site_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_rbac_delete ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_rbac_delete ON %I FOR DELETE TO authenticated
      USING (tenant_matches(tenant_id) AND can_access_operations_site(site_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. corrective_actions (script 48 — site derived from related records)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS corrective_actions_rbac_select ON corrective_actions;
CREATE POLICY corrective_actions_rbac_select
  ON corrective_actions
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
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
                AND tenant_matches(wo.tenant_id)
                AND can_access_operations_site(wo.site_id)
            )
          )
          OR (
            related_issue_no IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM failed_inspections fi
              WHERE fi.issue_no = corrective_actions.related_issue_no
                AND tenant_matches(fi.tenant_id)
                AND can_access_operations_site(fi.site_id)
            )
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
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND (
          (
            related_work_order IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM work_orders wo
              WHERE wo.work_order_no = corrective_actions.related_work_order
                AND tenant_matches(wo.tenant_id)
                AND can_access_operations_site(wo.site_id)
            )
          )
          OR (
            related_issue_no IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM failed_inspections fi
              WHERE fi.issue_no = corrective_actions.related_issue_no
                AND tenant_matches(fi.tenant_id)
                AND can_access_operations_site(fi.site_id)
            )
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
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND (
          (
            related_work_order IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM work_orders wo
              WHERE wo.work_order_no = corrective_actions.related_work_order
                AND tenant_matches(wo.tenant_id)
                AND can_access_operations_site(wo.site_id)
            )
          )
          OR (
            related_issue_no IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM failed_inspections fi
              WHERE fi.issue_no = corrective_actions.related_issue_no
                AND tenant_matches(fi.tenant_id)
                AND can_access_operations_site(fi.site_id)
            )
          )
        )
      )
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND (
          (
            related_work_order IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM work_orders wo
              WHERE wo.work_order_no = corrective_actions.related_work_order
                AND tenant_matches(wo.tenant_id)
                AND can_access_operations_site(wo.site_id)
            )
          )
          OR (
            related_issue_no IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM failed_inspections fi
              WHERE fi.issue_no = corrective_actions.related_issue_no
                AND tenant_matches(fi.tenant_id)
                AND can_access_operations_site(fi.site_id)
            )
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
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND (
          (
            related_work_order IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM work_orders wo
              WHERE wo.work_order_no = corrective_actions.related_work_order
                AND tenant_matches(wo.tenant_id)
                AND can_access_operations_site(wo.site_id)
            )
          )
          OR (
            related_issue_no IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM failed_inspections fi
              WHERE fi.issue_no = corrective_actions.related_issue_no
                AND tenant_matches(fi.tenant_id)
                AND can_access_operations_site(fi.site_id)
            )
          )
        )
      )
    )
  );

ALTER TABLE corrective_actions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 8. roster_history (script 48 + 56 company-wide supervisor SELECT)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS roster_history_rbac_select ON roster_history;
CREATE POLICY roster_history_rbac_select
  ON roster_history
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'hr'::app_role
      )
      OR current_user_role() = 'supervisor'::app_role
      OR employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_insert ON roster_history;
CREATE POLICY roster_history_rbac_insert
  ON roster_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND employee_id IS NOT NULL
        AND can_access_employee_record(
          (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id AND tenant_matches(e.tenant_id))
        )
      )
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_update ON roster_history;
CREATE POLICY roster_history_rbac_update
  ON roster_history
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND employee_id IS NOT NULL
        AND can_access_employee_record(
          (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id AND tenant_matches(e.tenant_id))
        )
      )
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND employee_id IS NOT NULL
        AND can_access_employee_record(
          (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id AND tenant_matches(e.tenant_id))
        )
      )
    )
  );

DROP POLICY IF EXISTS roster_history_rbac_delete ON roster_history;
CREATE POLICY roster_history_rbac_delete
  ON roster_history
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
      OR (
        current_user_role() = 'supervisor'::app_role
        AND employee_id IS NOT NULL
        AND can_access_employee_record(
          (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id AND tenant_matches(e.tenant_id))
        )
      )
    )
  );

ALTER TABLE roster_history ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 9. Leave / HR self-service (script 49)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leave_types_read_authenticated ON leave_types;
CREATE POLICY leave_types_read_authenticated
  ON leave_types
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS employee_leave_balances_select ON employee_leave_balances;
CREATE POLICY employee_leave_balances_select
  ON employee_leave_balances
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_manage_leave_balances()
      OR employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS employee_leave_balances_write ON employee_leave_balances;
CREATE POLICY employee_leave_balances_write
  ON employee_leave_balances
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_manage_leave_balances())
  WITH CHECK (tenant_matches(tenant_id) AND can_manage_leave_balances());

DROP POLICY IF EXISTS leave_approver_config_select ON leave_approver_config;
CREATE POLICY leave_approver_config_select
  ON leave_approver_config
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leave_approver_config_insert ON leave_approver_config;
CREATE POLICY leave_approver_config_insert
  ON leave_approver_config
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS leave_requests_select ON leave_requests;
CREATE POLICY leave_requests_select
  ON leave_requests
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_manage_leave_balances()
      OR employee_id = current_user_employee_id()
      OR is_assigned_leave_approver(approver_user_account_id)
    )
  );

DROP POLICY IF EXISTS leave_requests_insert ON leave_requests;
CREATE POLICY leave_requests_insert
  ON leave_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() = 'employee'::app_role
    AND employee_id = current_user_employee_id()
  );

DROP POLICY IF EXISTS leave_requests_update ON leave_requests;
CREATE POLICY leave_requests_update
  ON leave_requests
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      employee_id = current_user_employee_id()
      OR is_assigned_leave_approver(approver_user_account_id)
      OR can_manage_leave_balances()
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND (
      employee_id = current_user_employee_id()
      OR is_assigned_leave_approver(approver_user_account_id)
      OR can_manage_leave_balances()
    )
  );

DROP POLICY IF EXISTS payroll_history_self_service_select ON payroll_history;
CREATE POLICY payroll_history_self_service_select
  ON payroll_history
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_access_hr_payroll_data()
      OR employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS payroll_history_hr_write ON payroll_history;
CREATE POLICY payroll_history_hr_write
  ON payroll_history
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_hr_payroll_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_hr_payroll_data());

DROP POLICY IF EXISTS attendance_register_self_service_select ON attendance_register;
CREATE POLICY attendance_register_self_service_select
  ON attendance_register
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_access_hr_payroll_data()
      OR staff_id = current_user_staff_id()
    )
  );

DROP POLICY IF EXISTS attendance_register_hr_write ON attendance_register;
CREATE POLICY attendance_register_hr_write
  ON attendance_register
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_hr_payroll_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_hr_payroll_data());

ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_approver_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_register ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 10. Client portal (script 50)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS clients_rbac_select ON clients;
CREATE POLICY clients_rbac_select
  ON clients
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_client_record(client_id));

DROP POLICY IF EXISTS clients_rbac_write ON clients;
CREATE POLICY clients_rbac_write
  ON clients
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS income_register_select ON income_register;
CREATE POLICY income_register_select
  ON income_register
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_access_finance_income_data()
      OR (
        current_user_role() = 'client'::app_role
        AND client_id = current_user_client_id()
        AND entry_type = 'service'::income_entry_type
      )
    )
  );

DROP POLICY IF EXISTS income_register_write ON income_register;
CREATE POLICY income_register_write
  ON income_register
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

DROP POLICY IF EXISTS roster_config_client_select ON roster_config;
CREATE POLICY roster_config_client_select
  ON roster_config
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN ('operations_manager'::app_role, 'supervisor'::app_role)
      OR can_access_client_record(client_id)
    )
  );

DROP POLICY IF EXISTS roster_config_ops_write ON roster_config;
CREATE POLICY roster_config_ops_write
  ON roster_config
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'operations_manager'::app_role)
  );

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
        'supervisor'::app_role
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
  );

DROP POLICY IF EXISTS projects_admin_write ON projects;
CREATE POLICY projects_admin_write
  ON projects
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_register ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 11. manual_financial_entries (replace permissive policies from ad-hoc script)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can read manual financial entries" ON manual_financial_entries;
DROP POLICY IF EXISTS "Authenticated users can insert manual financial entries" ON manual_financial_entries;
DROP POLICY IF EXISTS "Authenticated users can update manual financial entries" ON manual_financial_entries;

DROP POLICY IF EXISTS manual_financial_entries_tenant_select ON manual_financial_entries;
CREATE POLICY manual_financial_entries_tenant_select
  ON manual_financial_entries
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS manual_financial_entries_tenant_write ON manual_financial_entries;
CREATE POLICY manual_financial_entries_tenant_write
  ON manual_financial_entries
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

ALTER TABLE manual_financial_entries ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 12. Remaining tables — tenant isolation for authenticated role
--     (Finance, inventory, payroll-processing, lookups, backups, etc.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable',
    'action_status_options',
    'approvers',
    'asset_categories',
    'asset_register',
    'capital_contributions',
    'casual_tax_rate_config',
    'complaint_priority_options',
    'consumables',
    'contract_status_options',
    'departments',
    'depreciation_methods',
    'disciplinary_records',
    'employee_employment_history',
    'equipment_register',
    'equipment_status_options',
    'exit_management',
    'expense_categories',
    'expense_register',
    'expense_subcategories',
    'finished_products',
    'fixed_assets',
    'incident_type_options',
    'inspection_result_options',
    'internal_consumption',
    'inventory_balance_config',
    'leave_management',
    'loan_register',
    'month_end_close',
    'month_end_close_backup_20260713c',
    'operations_config',
    'overtime_register',
    'pay_rate_structure',
    'paye_bands',
    'paye_config',
    'paye_tax_bands',
    'payment_methods',
    'payroll_history_backup_20260713c',
    'payroll_link',
    'payroll_processing',
    'positions',
    'production_batch_materials',
    'production_batches',
    'raw_material_purchases',
    'raw_materials',
    'recruitment_tracker',
    'risk_level_options',
    'salary_rate_config',
    'service_types',
    'severity_options',
    'ssnit_config',
    'ssnit_rate_config',
    'ssnit_rates',
    'stock_movements',
    'todos'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE NOTICE 'Skipping missing table for tenant RLS: %', v_table;
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_select ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_tenant_select ON %I FOR SELECT TO authenticated
      USING (tenant_matches(tenant_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_insert ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_tenant_insert ON %I FOR INSERT TO authenticated
      WITH CHECK (tenant_matches(tenant_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_update ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_tenant_update ON %I FOR UPDATE TO authenticated
      USING (tenant_matches(tenant_id))
      WITH CHECK (tenant_matches(tenant_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_delete ON %I', v_table, v_table);
    EXECUTE format(
      $p$
      CREATE POLICY %I_tenant_delete ON %I FOR DELETE TO authenticated
      USING (tenant_matches(tenant_id))
      $p$,
      v_table, v_table
    );

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
