-- Script 69: Remove legacy cross-tenant RLS policies (permissive OR leaks).
--
-- PREREQUISITES (must already be applied):
--   scripts/59_tenant_isolation_foundation.sql  — tenant_id columns + backfill
--   scripts/60_tenant_rls_policies.sql          — tenant_matches() + tenant-scoped RBAC
--   scripts/66_sales_rep_role.sql               — income_register_select (tenant-scoped)
--   scripts/67_sales_rep_pos_access.sql         — income_register_sales_rep_insert
--
-- PROBLEM:
--   Pre-multi-tenant policies (especially super_admin_full_access) grant
--   is_super_admin() access with NO tenant boundary. Postgres combines permissive
--   policies with OR, so any tenant's super_admin matches ALL rows on ALL tenants
--   even when script-60 tenant policies also exist.
--
-- FIX:
--   1. Drop every super_admin_full_access policy on public tables.
--   2. Drop other legacy RBAC / permissive policies that lack tenant_matches()
--      WHEN a tenant-scoped replacement already exists on the same table+command.
--   3. Rewrite (recreate) any remaining sole-path legacy policies on tenant tables
--      by re-applying the script-60 definitions idempotently.
--   4. Emit a verification report of any policies still missing tenant isolation.
--
-- Run scripts/audit-cross-tenant-rls-policies.sql before AND after this script.
-- DO NOT run on production until staging verification is complete.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Guardrails — refuse to run if script 60 tenant policies are missing
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.tenant_matches(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'tenant_matches(uuid) is missing. Apply scripts/59 and /60 before script/69.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'income_register'
      AND policyname = 'income_register_select'
      AND coalesce(qual, '') ILIKE '%tenant_matches(%'
  ) THEN
    RAISE EXCEPTION
      'income_register_select with tenant_matches() not found. Apply script/60 before script/69.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Drop ALL super_admin_full_access policies (primary leak vector)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rec record;
  v_dropped integer := 0;
BEGIN
  FOR v_rec IN
    SELECT schemaname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'super_admin_full_access'
    ORDER BY tablename
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS super_admin_full_access ON %I.%I',
      v_rec.schemaname,
      v_rec.tablename
    );
    v_dropped := v_dropped + 1;
    RAISE NOTICE 'Dropped super_admin_full_access on %.%', v_rec.schemaname, v_rec.tablename;
  END LOOP;

  RAISE NOTICE 'Step 1 complete: dropped % super_admin_full_access policies', v_dropped;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Drop globally permissive policies on tenant-scoped tables
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read access for all users" ON public.todos;

DROP POLICY IF EXISTS "Authenticated users can read manual financial entries"
  ON public.manual_financial_entries;
DROP POLICY IF EXISTS "Authenticated users can insert manual financial entries"
  ON public.manual_financial_entries;
DROP POLICY IF EXISTS "Authenticated users can update manual financial entries"
  ON public.manual_financial_entries;

-- ---------------------------------------------------------------------------
-- 3. Drop legacy pre-script-60 RBAC policies that lack tenant_matches()
--    ONLY when a tenant-scoped sibling policy exists for the same command.
--    (If script 60 ran, these should already be gone; this is a safety net
--    when both old and new policies coexist.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rec record;
  v_dropped integer := 0;
BEGIN
  FOR v_rec IN
    SELECT
      p.schemaname,
      p.tablename,
      p.policyname,
      p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.policyname <> 'super_admin_full_access'
      AND p.policyname <> 'user_can_read_own_account'
      AND (
        coalesce(p.qual, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
        OR coalesce(p.with_check, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
      )
      AND NOT (
        coalesce(p.qual, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
        OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_policies p2
        WHERE p2.schemaname = p.schemaname
          AND p2.tablename = p.tablename
          AND p2.cmd = p.cmd
          AND p2.policyname <> p.policyname
          AND (
            coalesce(p2.qual, '') ILIKE '%tenant_matches(%'
            OR coalesce(p2.qual, '') ILIKE '%current_user_tenant_id()%'
            OR coalesce(p2.with_check, '') ILIKE '%tenant_matches(%'
            OR coalesce(p2.with_check, '') ILIKE '%current_user_tenant_id()%'
          )
      )
    ORDER BY p.tablename, p.policyname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_rec.policyname,
      v_rec.schemaname,
      v_rec.tablename
    );
    v_dropped := v_dropped + 1;
    RAISE NOTICE 'Dropped legacy leaky policy % on % (cmd=%)', v_rec.policyname, v_rec.tablename, v_rec.cmd;
  END LOOP;

  RAISE NOTICE 'Step 3 complete: dropped % coexisting legacy policies', v_dropped;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Rewrite sole-path legacy policies on key tenant tables (script 60 defs)
--    Idempotent: DROP IF EXISTS + CREATE. Only needed if script 60 did not
--    fully replace an old policy, or step 3 could not drop (no sibling yet).
-- ---------------------------------------------------------------------------

-- user_account_supervisor_sites
DROP POLICY IF EXISTS supervisor_sites_super_admin_all ON user_account_supervisor_sites;
CREATE POLICY supervisor_sites_super_admin_all
  ON user_account_supervisor_sites
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

-- income_register (SELECT + write + sales_rep insert from 60/66/67)
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
      OR (
        current_user_role() = 'sales_rep'::app_role
        AND entry_type = 'product_sale'::income_entry_type
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

DROP POLICY IF EXISTS income_register_sales_rep_insert ON income_register;
CREATE POLICY income_register_sales_rep_insert
  ON income_register
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() = 'sales_rep'::app_role
    AND entry_type = 'product_sale'::income_entry_type
  );

-- user_accounts (keep user_can_read_own_account; ensure tenant-scoped admin paths)
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

-- manual_financial_entries
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

-- ---------------------------------------------------------------------------
-- 5. Ensure section-12 tenant CRUD policies exist on finance/inventory tables
--    (idempotent — safe if script 60 already created them)
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
      RAISE NOTICE 'Skipping missing table: %', v_table;
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

-- ---------------------------------------------------------------------------
-- 6. Post-migration verification — warn if any leaky policies remain
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_remaining integer;
  v_rec record;
BEGIN
  WITH leaky_policies AS (
    SELECT
      p.tablename,
      p.policyname,
      p.cmd
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.policyname <> 'user_can_read_own_account'
      AND (
        coalesce(p.qual, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
        OR coalesce(p.with_check, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
      )
      AND NOT (
        coalesce(p.qual, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
        OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
        OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
      )
  )
  SELECT count(*) INTO v_remaining
  FROM leaky_policies;

  IF v_remaining > 0 THEN
    RAISE WARNING 'Script 69 finished but % policies still lack tenant isolation:', v_remaining;
    FOR v_rec IN
      WITH leaky_policies AS (
        SELECT
          p.tablename,
          p.policyname,
          p.cmd
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.policyname <> 'user_can_read_own_account'
          AND (
            coalesce(p.qual, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
            OR coalesce(p.with_check, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
          )
          AND NOT (
            coalesce(p.qual, '') ILIKE '%tenant_matches(%'
            OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
            OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
            OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
          )
      )
      SELECT
        tablename,
        policyname,
        cmd
      FROM leaky_policies
      ORDER BY tablename, policyname
    LOOP
      RAISE WARNING '  - %.% (cmd=%)', v_rec.tablename, v_rec.policyname, v_rec.cmd;
    END LOOP;
  ELSE
    RAISE NOTICE 'Verification passed: no role/can_access policies lacking tenant isolation (except user_can_read_own_account).';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
