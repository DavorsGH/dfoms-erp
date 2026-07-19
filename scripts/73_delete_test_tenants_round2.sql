-- Script 73: Delete round-2 test tenants (Caanta Test, Davors Facilities [dup],
-- Davors Test, Caanta) and all their data, across every tenant_id-scoped table
-- plus the Davors-scoped crm_subscriptions/customers rows tied to them.
--
-- Target tenant IDs (verify names in tenants before running):
--   27fffd62-a7a9-455d-a5b1-2f91e001ec69 (Caanta Test)
--   f589566f-24bb-4c8b-aa17-be247c6b747d (Davors Facilities, dup)
--   e3329c08-d746-4fbb-b5e3-3b2c7a31b759 (Davors Test)
--   3d66c002-d14e-4627-98ba-049fbb116ca3 (Caanta)
--
-- These were created during signup email verification testing (2026-07-19).

BEGIN;

DO $$
DECLARE
  v_davors_tenant_id CONSTANT uuid := '00000001-0000-4000-8000-000000000001'::uuid;
  v_tenant_ids uuid[] := ARRAY[
    '27fffd62-a7a9-455d-a5b1-2f91e001ec69'::uuid,
    'f589566f-24bb-4c8b-aa17-be247c6b747d'::uuid,
    'e3329c08-d746-4fbb-b5e3-3b2c7a31b759'::uuid,
    '3d66c002-d14e-4627-98ba-049fbb116ca3'::uuid
  ];
  v_customer_ids text[];
  v_auth_uids uuid[];
  v_table text;
  v_deleted bigint;
  v_tenant_tables text[] := ARRAY[
    'accounts_payable', 'action_status_options', 'approvers', 'asset_categories',
    'asset_register', 'attendance_register', 'capital_contributions',
    'casual_tax_rate_config', 'clients', 'complaint_priority_options',
    'complaint_register', 'consumables', 'contract_status_options',
    'corrective_actions', 'crm_products', 'crm_sales', 'departments',
    'depreciation_methods', 'disciplinary_records', 'employee_employment_history',
    'employee_leave_balances', 'employees', 'equipment_register',
    'equipment_status_options', 'exit_management', 'expense_categories',
    'expense_register', 'expense_subcategories', 'failed_inspections',
    'finished_products', 'fixed_assets', 'incident_register',
    'incident_type_options', 'income_register', 'inspection_result_options',
    'inspection_summary', 'internal_consumption', 'inventory_balance_config',
    'leave_approver_config', 'leave_management', 'leave_requests', 'leave_types',
    'loan_register', 'manual_financial_entries', 'month_end_close',
    'operations_config', 'overtime_register', 'pay_rate_structure', 'paye_bands',
    'paye_config', 'paye_tax_bands', 'payment_methods', 'payroll_history',
    'payroll_link', 'payroll_processing', 'positions',
    'production_batch_materials', 'production_batches', 'projects',
    'raw_material_purchases', 'raw_materials', 'recruitment_tracker',
    'risk_level_options', 'roles', 'roster_config', 'roster_history',
    'salary_rate_config', 'service_types', 'severity_options', 'sites',
    'ssnit_config', 'ssnit_rate_config', 'ssnit_rates', 'stock_movements',
    'todos', 'user_account_supervisor_sites', 'user_accounts', 'work_orders'
  ];
BEGIN
  IF v_davors_tenant_id = ANY(v_tenant_ids) THEN
    RAISE EXCEPTION 'Refusing to delete Davors platform tenant %', v_davors_tenant_id;
  END IF;

  -- Auth users linked to these tenants (delete after user_accounts rows).
  SELECT array_agg(auth_uid) INTO v_auth_uids
  FROM user_accounts
  WHERE tenant_id = ANY(v_tenant_ids);

  -- Davors-scoped CRM customer IDs tied to these test tenants.
  SELECT array_agg(DISTINCT customer_id) INTO v_customer_ids
  FROM crm_subscriptions
  WHERE linked_tenant_id = ANY(v_tenant_ids)
    AND customer_id IS NOT NULL;

  DELETE FROM crm_subscriptions
  WHERE linked_tenant_id = ANY(v_tenant_ids);

  IF v_customer_ids IS NOT NULL THEN
    DELETE FROM customers
    WHERE tenant_id = v_davors_tenant_id
      AND client_id = ANY(v_customer_ids);
  END IF;

  FOREACH v_table IN ARRAY v_tenant_tables
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE NOTICE 'Skipping missing table: %', v_table;
      CONTINUE;
    END IF;

    EXECUTE format('DELETE FROM %I WHERE tenant_id = ANY($1)', v_table)
    USING v_tenant_ids;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % row(s) from %', v_deleted, v_table;
  END LOOP;

  IF v_auth_uids IS NOT NULL THEN
    RAISE NOTICE 'Auth users NOT deleted by this script (delete manually via Supabase Auth dashboard): %', v_auth_uids;
  END IF;

  DELETE FROM tenants
  WHERE id = ANY(v_tenant_ids);

  RAISE NOTICE 'Deleted % tenant registry row(s)', array_length(v_tenant_ids, 1);
END $$;

COMMIT;
