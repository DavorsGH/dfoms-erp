-- Script 59: Phase 1 — Tenant isolation foundation (schema only).
-- Target: staging/local. Review before production.
--
-- Prerequisites: branch multi-tenant-foundation, pre-migration backup taken.
-- Next step: verify, then apply scripts/60_tenant_rls_policies.sql.
--
-- Davors Facilities Management Services Ltd = Tenant 1.
-- Fixed UUID for idempotent cross-environment backfill.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tenant registry
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE tenant_status AS ENUM ('active', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  status     tenant_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE tenants IS 'Multi-tenant registry. Does not carry tenant_id.';
COMMENT ON COLUMN tenants.slug IS 'URL-safe identifier for future subdomain routing.';

-- Tenant 1 — Davors Facilities Management Services Ltd
INSERT INTO tenants (id, name, slug, status)
VALUES (
  '00000001-0000-4000-8000-000000000001'::uuid,
  'Davors Facilities Management Services Ltd',
  'davors-facilities',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET name   = EXCLUDED.name,
    slug   = EXCLUDED.slug,
    status = EXCLUDED.status;

-- ---------------------------------------------------------------------------
-- 2. Add tenant_id (nullable) to every public table in schema-inventory.md
--    Skips: tenants (registry). Does not touch generated columns.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_davors_tenant_id CONSTANT uuid := '00000001-0000-4000-8000-000000000001'::uuid;
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable',
    'action_status_options',
    'approvers',
    'asset_categories',
    'asset_register',
    'attendance_register',
    'capital_contributions',
    'casual_tax_rate_config',
    'clients',
    'complaint_priority_options',
    'complaint_register',
    'consumables',
    'contract_status_options',
    'corrective_actions',
    'departments',
    'depreciation_methods',
    'disciplinary_records',
    'employee_employment_history',
    'employee_leave_balances',
    'employees',
    'equipment_register',
    'equipment_status_options',
    'exit_management',
    'expense_categories',
    'expense_register',
    'expense_subcategories',
    'failed_inspections',
    'finished_products',
    'fixed_assets',
    'incident_register',
    'incident_type_options',
    'income_register',
    'inspection_result_options',
    'inspection_summary',
    'internal_consumption',
    'inventory_balance_config',
    'leave_approver_config',
    'leave_management',
    'leave_requests',
    'leave_types',
    'loan_register',
    'manual_financial_entries',
    'month_end_close',
    'month_end_close_backup_20260713c',
    'operations_config',
    'overtime_register',
    'pay_rate_structure',
    'paye_bands',
    'paye_config',
    'paye_tax_bands',
    'payment_methods',
    'payroll_history',
    'payroll_history_backup_20260713c',
    'payroll_link',
    'payroll_processing',
    'positions',
    'production_batch_materials',
    'production_batches',
    'projects',
    'raw_material_purchases',
    'raw_materials',
    'recruitment_tracker',
    'risk_level_options',
    'roles',
    'roster_config',
    'roster_history',
    'salary_rate_config',
    'service_types',
    'severity_options',
    'sites',
    'ssnit_config',
    'ssnit_rate_config',
    'ssnit_rates',
    'stock_movements',
    'todos',
    'user_account_supervisor_sites',
    'user_accounts',
    'work_orders'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE NOTICE 'Skipping missing table: %', v_table;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id)',
      v_table
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill all rows with Davors tenant ID (before NOT NULL enforcement)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_davors_tenant_id CONSTANT uuid := '00000001-0000-4000-8000-000000000001'::uuid;
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable', 'action_status_options', 'approvers', 'asset_categories',
    'asset_register', 'attendance_register', 'capital_contributions',
    'casual_tax_rate_config', 'clients', 'complaint_priority_options',
    'complaint_register', 'consumables', 'contract_status_options',
    'corrective_actions', 'departments', 'depreciation_methods',
    'disciplinary_records', 'employee_employment_history', 'employee_leave_balances',
    'employees', 'equipment_register', 'equipment_status_options', 'exit_management',
    'expense_categories', 'expense_register', 'expense_subcategories',
    'failed_inspections', 'finished_products', 'fixed_assets', 'incident_register',
    'incident_type_options', 'income_register', 'inspection_result_options',
    'inspection_summary', 'internal_consumption', 'inventory_balance_config',
    'leave_approver_config', 'leave_management', 'leave_requests', 'leave_types',
    'loan_register', 'manual_financial_entries', 'month_end_close',
    'month_end_close_backup_20260713c', 'operations_config', 'overtime_register',
    'pay_rate_structure', 'paye_bands', 'paye_config', 'paye_tax_bands',
    'payment_methods', 'payroll_history', 'payroll_history_backup_20260713c',
    'payroll_link', 'payroll_processing', 'positions', 'production_batch_materials',
    'production_batches', 'projects', 'raw_material_purchases', 'raw_materials',
    'recruitment_tracker', 'risk_level_options', 'roles', 'roster_config',
    'roster_history', 'salary_rate_config', 'service_types', 'severity_options',
    'sites', 'ssnit_config', 'ssnit_rate_config', 'ssnit_rates', 'stock_movements',
    'todos', 'user_account_supervisor_sites', 'user_accounts', 'work_orders'
  ];
  v_updated bigint;
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE %I SET tenant_id = $1 WHERE tenant_id IS NULL',
      v_table
    ) USING v_davors_tenant_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE 'Backfilled % rows in %', v_updated, v_table;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Enforce NOT NULL on tenant_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable', 'action_status_options', 'approvers', 'asset_categories',
    'asset_register', 'attendance_register', 'capital_contributions',
    'casual_tax_rate_config', 'clients', 'complaint_priority_options',
    'complaint_register', 'consumables', 'contract_status_options',
    'corrective_actions', 'departments', 'depreciation_methods',
    'disciplinary_records', 'employee_employment_history', 'employee_leave_balances',
    'employees', 'equipment_register', 'equipment_status_options', 'exit_management',
    'expense_categories', 'expense_register', 'expense_subcategories',
    'failed_inspections', 'finished_products', 'fixed_assets', 'incident_register',
    'incident_type_options', 'income_register', 'inspection_result_options',
    'inspection_summary', 'internal_consumption', 'inventory_balance_config',
    'leave_approver_config', 'leave_management', 'leave_requests', 'leave_types',
    'loan_register', 'manual_financial_entries', 'month_end_close',
    'month_end_close_backup_20260713c', 'operations_config', 'overtime_register',
    'pay_rate_structure', 'paye_bands', 'paye_config', 'paye_tax_bands',
    'payment_methods', 'payroll_history', 'payroll_history_backup_20260713c',
    'payroll_link', 'payroll_processing', 'positions', 'production_batch_materials',
    'production_batches', 'projects', 'raw_material_purchases', 'raw_materials',
    'recruitment_tracker', 'risk_level_options', 'roles', 'roster_config',
    'roster_history', 'salary_rate_config', 'service_types', 'severity_options',
    'sites', 'ssnit_config', 'ssnit_rate_config', 'ssnit_rates', 'stock_movements',
    'todos', 'user_account_supervisor_sites', 'user_accounts', 'work_orders'
  ];
  v_null_count bigint;
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE tenant_id IS NULL',
      v_table
    ) INTO v_null_count;

    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Table % still has % NULL tenant_id rows', v_table, v_null_count;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL',
      v_table
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 5. roles — composite primary key (code alone is not unique across tenants)
-- ---------------------------------------------------------------------------
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_pkey;
ALTER TABLE roles ADD CONSTRAINT roles_pkey PRIMARY KEY (tenant_id, code);

-- ---------------------------------------------------------------------------
-- 6. Indexes on tenant_id (one per table)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable', 'action_status_options', 'approvers', 'asset_categories',
    'asset_register', 'attendance_register', 'capital_contributions',
    'casual_tax_rate_config', 'clients', 'complaint_priority_options',
    'complaint_register', 'consumables', 'contract_status_options',
    'corrective_actions', 'departments', 'depreciation_methods',
    'disciplinary_records', 'employee_employment_history', 'employee_leave_balances',
    'employees', 'equipment_register', 'equipment_status_options', 'exit_management',
    'expense_categories', 'expense_register', 'expense_subcategories',
    'failed_inspections', 'finished_products', 'fixed_assets', 'incident_register',
    'incident_type_options', 'income_register', 'inspection_result_options',
    'inspection_summary', 'internal_consumption', 'inventory_balance_config',
    'leave_approver_config', 'leave_management', 'leave_requests', 'leave_types',
    'loan_register', 'manual_financial_entries', 'month_end_close',
    'month_end_close_backup_20260713c', 'operations_config', 'overtime_register',
    'pay_rate_structure', 'paye_bands', 'paye_config', 'paye_tax_bands',
    'payment_methods', 'payroll_history', 'payroll_history_backup_20260713c',
    'payroll_link', 'payroll_processing', 'positions', 'production_batch_materials',
    'production_batches', 'projects', 'raw_material_purchases', 'raw_materials',
    'recruitment_tracker', 'risk_level_options', 'roles', 'roster_config',
    'roster_history', 'salary_rate_config', 'service_types', 'severity_options',
    'sites', 'ssnit_config', 'ssnit_rate_config', 'ssnit_rates', 'stock_movements',
    'todos', 'user_account_supervisor_sites', 'user_accounts', 'work_orders'
  ];
  v_index_name text;
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    v_index_name := format('idx_%s_tenant_id', v_table);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (tenant_id)',
      v_index_name,
      v_table
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Tenant session helper + auto-fill trigger (authenticated sessions)
--    Service-role callers must set tenant_id explicitly when auth.uid() is NULL.
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

GRANT EXECUTE ON FUNCTION current_user_tenant_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION enforce_row_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_tenant_id uuid;
BEGIN
  v_session_tenant_id := current_user_tenant_id();

  IF NEW.tenant_id IS NULL THEN
    IF v_session_tenant_id IS NULL THEN
      RAISE EXCEPTION 'tenant_id is required when no authenticated tenant context exists';
    END IF;
    NEW.tenant_id := v_session_tenant_id;
  ELSIF v_session_tenant_id IS NOT NULL AND NEW.tenant_id <> v_session_tenant_id THEN
    RAISE EXCEPTION 'tenant_id % does not match session tenant %', NEW.tenant_id, v_session_tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'accounts_payable', 'action_status_options', 'approvers', 'asset_categories',
    'asset_register', 'attendance_register', 'capital_contributions',
    'casual_tax_rate_config', 'clients', 'complaint_priority_options',
    'complaint_register', 'consumables', 'contract_status_options',
    'corrective_actions', 'departments', 'depreciation_methods',
    'disciplinary_records', 'employee_employment_history', 'employee_leave_balances',
    'employees', 'equipment_register', 'equipment_status_options', 'exit_management',
    'expense_categories', 'expense_register', 'expense_subcategories',
    'failed_inspections', 'finished_products', 'fixed_assets', 'incident_register',
    'incident_type_options', 'income_register', 'inspection_result_options',
    'inspection_summary', 'internal_consumption', 'inventory_balance_config',
    'leave_approver_config', 'leave_management', 'leave_requests', 'leave_types',
    'loan_register', 'manual_financial_entries', 'month_end_close',
    'month_end_close_backup_20260713c', 'operations_config', 'overtime_register',
    'pay_rate_structure', 'paye_bands', 'paye_config', 'paye_tax_bands',
    'payment_methods', 'payroll_history', 'payroll_history_backup_20260713c',
    'payroll_link', 'payroll_processing', 'positions', 'production_batch_materials',
    'production_batches', 'projects', 'raw_material_purchases', 'raw_materials',
    'recruitment_tracker', 'risk_level_options', 'roles', 'roster_config',
    'roster_history', 'salary_rate_config', 'service_types', 'severity_options',
    'sites', 'ssnit_config', 'ssnit_rate_config', 'ssnit_rates', 'stock_movements',
    'todos', 'user_account_supervisor_sites', 'user_accounts', 'work_orders'
  ];
  v_trigger_name text;
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    v_trigger_name := format('trg_%s_enforce_tenant_id', v_table);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', v_trigger_name, v_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF tenant_id ON %I FOR EACH ROW EXECUTE FUNCTION enforce_row_tenant_id()',
      v_trigger_name,
      v_table
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 8. Data API grants for tenants table
-- ---------------------------------------------------------------------------
GRANT SELECT ON tenants TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Post-migration verification (run manually after COMMIT)
-- ---------------------------------------------------------------------------
-- SELECT table_name,
--        COUNT(*) FILTER (WHERE tenant_id IS DISTINCT FROM '00000001-0000-4000-8000-000000000001'::uuid) AS wrong_tenant,
--        COUNT(*) FILTER (WHERE tenant_id IS NULL) AS null_tenant
-- FROM (
--   SELECT 'employees' AS table_name, tenant_id FROM employees
--   UNION ALL SELECT 'clients', tenant_id FROM clients
--   -- extend as needed
-- ) s
-- GROUP BY 1;

NOTIFY pgrst, 'reload schema';

COMMIT;
