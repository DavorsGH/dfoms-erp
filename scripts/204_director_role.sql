-- Script 204: Add global director role (finance + HR + operations_manager full edit).
-- Real Estate remains app-layer gated to Davors platform tenant (see TS helpers).
-- Staging only until verified.
--
-- PG 12+: ADD VALUE is transactional; IF NOT EXISTS avoids re-run errors.

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'director';

BEGIN;

-- ---------------------------------------------------------------------------
-- PART A: roles reference table (one row per tenant)
-- ---------------------------------------------------------------------------
INSERT INTO roles (tenant_id, code, label, sort_order)
  SELECT t.id, 'director', 'Director', 9 FROM tenants t
ON CONFLICT (tenant_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- PART C: RBAC helper functions
-- ---------------------------------------------------------------------------

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
    'hr'::app_role,
    'director'::app_role
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
    WHEN 'director'::app_role THEN true
    WHEN 'supervisor'::app_role THEN true
    WHEN 'client'::app_role THEN
      p_client_id IS NOT NULL
      AND p_client_id = current_user_client_id()
    ELSE false
  END;
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
    WHEN 'director'::app_role THEN true
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
    WHEN 'director'::app_role THEN true
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
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION can_access_hr_payroll_data()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION can_manage_leave_balances()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

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
    'director'::app_role,
    'supervisor'::app_role
  );
$$;

-- ---------------------------------------------------------------------------
-- PART C: Inline role-list policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS sites_rbac_select ON sites;
CREATE POLICY sites_rbac_select
  ON sites
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
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

DROP POLICY IF EXISTS corrective_actions_rbac_select ON corrective_actions;
CREATE POLICY corrective_actions_rbac_select
  ON corrective_actions
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
        'hr'::app_role,
        'director'::app_role
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
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
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role
      )
      OR (
        current_user_role() = 'supervisor'::app_role
        AND employee_id IS NOT NULL
        AND can_access_employee_record(
          (SELECT e.assigned_site_id FROM employees e WHERE e.employee_id = roster_history.employee_id AND tenant_matches(e.tenant_id))
        )
      )
    )
  );

DROP POLICY IF EXISTS roster_config_ops_write ON roster_config;
CREATE POLICY roster_config_ops_write
  ON roster_config
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS manual_financial_entries_tenant_write ON manual_financial_entries;
CREATE POLICY manual_financial_entries_tenant_write
  ON manual_financial_entries
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS accounts_payable_payments_tenant_insert ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_insert
  ON public.accounts_payable_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS accounts_payable_payments_tenant_update ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_update
  ON public.accounts_payable_payments
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS accounts_payable_payments_tenant_delete ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_delete
  ON public.accounts_payable_payments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS directors_loan_repayments_tenant_insert ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_insert
  ON public.directors_loan_repayments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS directors_loan_repayments_tenant_update ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_update
  ON public.directors_loan_repayments
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS directors_loan_repayments_tenant_delete ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_delete
  ON public.directors_loan_repayments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_invoice_payments_finance_write ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_write
  ON public.client_invoice_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_invoice_payments_finance_update ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_update
  ON public.client_invoice_payments
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_invoice_payments_finance_delete ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_delete
  ON public.client_invoice_payments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_receipts_finance_write ON public.client_receipts;
CREATE POLICY client_receipts_finance_write
  ON public.client_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_receipts_finance_update ON public.client_receipts;
CREATE POLICY client_receipts_finance_update
  ON public.client_receipts
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS client_receipts_finance_delete ON public.client_receipts;
CREATE POLICY client_receipts_finance_delete
  ON public.client_receipts
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS employee_notifications_insert_hr ON public.employee_notifications;
CREATE POLICY employee_notifications_insert_hr
  ON public.employee_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'hr'::app_role,
      'director'::app_role
    )
  );

-- ---------------------------------------------------------------------------
-- PART C: RPC role guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_sales_opportunity(
  p_opportunity_id uuid,
  p_client_id text,
  p_opportunity_name text,
  p_estimated_value numeric DEFAULT NULL,
  p_probability integer DEFAULT NULL,
  p_expected_close_date date DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_assigned_to text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_opportunity public.sales_opportunities%ROWTYPE;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to edit sales opportunities';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  SELECT *
  INTO v_opportunity
  FROM public.sales_opportunities
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  IF NULLIF(trim(p_client_id), '') IS NULL THEN
    RAISE EXCEPTION 'Customer is required';
  END IF;

  IF NULLIF(trim(p_opportunity_name), '') IS NULL THEN
    RAISE EXCEPTION 'Opportunity name is required';
  END IF;

  IF p_estimated_value IS NOT NULL AND p_estimated_value < 0 THEN
    RAISE EXCEPTION 'Estimated value must be non-negative';
  END IF;

  IF p_probability IS NOT NULL AND (p_probability < 0 OR p_probability > 100) THEN
    RAISE EXCEPTION 'Probability must be between 0 and 100';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.client_id = trim(p_client_id)
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Selected customer does not exist in your workspace';
  END IF;

  IF NULLIF(trim(p_assigned_to), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.employee_id = trim(p_assigned_to)
      AND e.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Selected assigned rep does not exist in your workspace';
  END IF;

  UPDATE public.sales_opportunities
  SET
    client_id = trim(p_client_id),
    opportunity_name = trim(p_opportunity_name),
    estimated_value = p_estimated_value,
    probability = p_probability,
    expected_close_date = p_expected_close_date,
    source = NULLIF(trim(p_source), ''),
    assigned_to = NULLIF(trim(p_assigned_to), ''),
    notes = NULLIF(trim(p_notes), ''),
    updated_at = now()
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  RETURN p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sales_opportunity(
  p_opportunity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_quotation_count integer := 0;
  v_quote_count integer := 0;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to delete sales opportunities';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_opportunities
    WHERE id = p_opportunity_id
      AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  SELECT count(*)::integer
  INTO v_quotation_count
  FROM public.client_quotations
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  IF v_quotation_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: % quotation(s) are linked to this opportunity. Remove or reassign them first.',
      v_quotation_count;
  END IF;

  SELECT count(*)::integer
  INTO v_quote_count
  FROM public.sales_quotes
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  IF v_quote_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: % product quote(s) are linked to this opportunity. Remove or reassign them first.',
      v_quote_count;
  END IF;

  DELETE FROM public.sales_activities
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  DELETE FROM public.sales_opportunities
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_commission_status(
  p_calc_id uuid,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_current_status text;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to update commission status';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  SELECT status
  INTO v_current_status
  FROM public.commission_calculations
  WHERE id = p_calc_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission calculation not found';
  END IF;

  IF p_new_status = 'approved' AND v_current_status = 'pending' THEN
    UPDATE public.commission_calculations
    SET status = 'approved',
        approved_at = now()
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  IF p_new_status = 'paid' AND v_current_status = 'approved' THEN
    UPDATE public.commission_calculations
    SET status = 'paid',
        paid_at = now()
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  IF p_new_status = 'cancelled' AND v_current_status = 'pending' THEN
    UPDATE public.commission_calculations
    SET status = 'cancelled',
        approved_at = NULL,
        paid_at = NULL
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Invalid commission status transition from % to %',
    v_current_status, p_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_employee_leave_balances_for_year(
  p_employee_id text,
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::integer);
  v_employee employees%ROWTYPE;
  v_lt RECORD;
  v_entitled numeric(8, 2);
  v_inserted integer := 0;
  v_rowcount integer;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role,
    'director'::app_role
  ) THEN
    RAISE EXCEPTION 'Not authorized to create employee leave balances';
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee % not found', p_employee_id;
  END IF;

  IF v_employee.tenant_id IS NULL OR NOT tenant_matches(v_employee.tenant_id) THEN
    RAISE EXCEPTION 'Tenant mismatch for employee %', p_employee_id;
  END IF;

  FOR v_lt IN
    SELECT lt.id, lt.type_name
    FROM leave_types lt
    WHERE lt.type_name = ANY (ARRAY[
      'Annual Leave'::text,
      'Sick Leave'::text,
      'Unpaid Leave'::text
    ])
  LOOP
    v_entitled := public.resolve_leave_entitlement(
      v_employee.tenant_id,
      v_employee."position",
      v_employee.employment_type,
      v_lt.type_name
    );

    INSERT INTO employee_leave_balances (
      tenant_id,
      employee_id,
      leave_type_id,
      year,
      entitled_days,
      days_used
    )
    VALUES (
      v_employee.tenant_id,
      v_employee.employee_id,
      v_lt.id,
      v_year,
      v_entitled,
      0
    )
    ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING;

    GET DIAGNOSTICS v_rowcount = ROW_COUNT;
    IF v_rowcount > 0 THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_sales_opportunity(
  uuid, text, text, numeric, integer, date, text, text, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_sales_opportunity(uuid)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_commission_status(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
