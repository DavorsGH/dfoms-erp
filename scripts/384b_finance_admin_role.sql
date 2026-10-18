BEGIN;

INSERT INTO roles (tenant_id, code, label, sort_order)
  SELECT t.id, 'finance_admin', 'Finance & Admin Officer', 10 FROM tenants t
ON CONFLICT (tenant_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.can_access_finance_income_data()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'finance_admin'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_client_record(p_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'finance_admin'::app_role THEN true
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

CREATE OR REPLACE FUNCTION public.can_access_employee_record(p_assigned_site_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'finance_admin'::app_role THEN true
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

CREATE OR REPLACE FUNCTION public.can_write_employee_records()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'finance_admin'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_delete_employee_records()
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

CREATE OR REPLACE FUNCTION public.can_access_hr_payroll_data()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT current_user_role() IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'finance_admin'::app_role,
    'hr'::app_role,
    'director'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_duty_roster_company_wide()
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
    'supervisor'::app_role,
    'finance_admin'::app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_operations_site_for_read(p_site_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN current_user_role() = 'finance_admin'::app_role THEN true
    ELSE can_access_operations_site(p_site_code)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_delete_employee_records() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_operations_site_for_read(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_employees_finance_admin_pay_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user_role() IS DISTINCT FROM 'finance_admin'::app_role THEN
    RETURN NEW;
  END IF;

  IF NEW.basic_salary IS DISTINCT FROM OLD.basic_salary
    OR NEW.housing_allowance IS DISTINCT FROM OLD.housing_allowance
    OR NEW.transport_allowance IS DISTINCT FROM OLD.transport_allowance
    OR NEW.other_allowances IS DISTINCT FROM OLD.other_allowances
    OR NEW.welfare_deduction_rate IS DISTINCT FROM OLD.welfare_deduction_rate
    OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
    OR NEW.bank_name IS DISTINCT FROM OLD.bank_name
    OR NEW.account_number IS DISTINCT FROM OLD.account_number
    OR NEW.momo_number IS DISTINCT FROM OLD.momo_number
    OR NEW.momo_name IS DISTINCT FROM OLD.momo_name
  THEN
    RAISE EXCEPTION 'Finance & Admin Officer cannot edit employee pay fields';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_employee_employment_history_finance_admin_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_user_role() = 'finance_admin'::app_role THEN
    RAISE EXCEPTION 'Finance & Admin Officer cannot insert employment history pay records';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_finance_admin_pay_guard ON public.employees;
CREATE TRIGGER trg_employees_finance_admin_pay_guard
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_employees_finance_admin_pay_guard();

DROP TRIGGER IF EXISTS trg_employee_employment_history_finance_admin_block ON public.employee_employment_history;
CREATE TRIGGER trg_employee_employment_history_finance_admin_block
  BEFORE INSERT ON public.employee_employment_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_employee_employment_history_finance_admin_block();

CREATE OR REPLACE FUNCTION public.finance_admin_employee_pay_value_allowed(
  p_actual numeric,
  p_expected numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_expected IS NULL THEN
      p_actual IS NULL OR round(COALESCE(p_actual, 0), 2) = 0
    WHEN p_actual IS NULL THEN
      round(COALESCE(p_expected, 0), 2) = 0
    ELSE
      round(COALESCE(p_actual, 0), 2) = round(COALESCE(p_expected, 0), 2)
  END;
$$;

CREATE OR REPLACE FUNCTION public.finance_admin_expected_employee_pay(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_position text,
  p_employment_type text,
  p_shift text
)
RETURNS TABLE (
  basic_salary numeric,
  housing_allowance numeric,
  transport_allowance numeric,
  other_allowances numeric,
  welfare_deduction_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos text := nullif(btrim(p_position), '');
  v_emp text := nullif(btrim(p_employment_type), '');
  v_shift text := nullif(btrim(p_shift), '');
  v_basic numeric := 0;
  v_housing numeric := 0;
  v_transport numeric := 0;
  v_other numeric := 0;
  v_welfare numeric := NULL;
BEGIN
  IF v_pos IS NOT NULL AND v_emp IS NOT NULL AND v_shift IS NOT NULL THEN
    SELECT src.basic_salary
    INTO v_basic
    FROM public.salary_rate_config src
    WHERE src.tenant_id = p_tenant_id
      AND src.position = v_pos
      AND src.employment_type = v_emp
      AND src.shift = v_shift
      AND src.effective_date::date <= current_date
    ORDER BY src.effective_date DESC
    LIMIT 1;

    v_basic := COALESCE(v_basic, 0);

    SELECT
      COALESCE(
        sum(
          CASE
            WHEN at.code = 'HOUSING' THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      ),
      COALESCE(
        sum(
          CASE
            WHEN at.code = 'TRANSPORT' THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      ),
      COALESCE(
        sum(
          CASE
            WHEN at.code NOT IN ('HOUSING', 'TRANSPORT') THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      )
    INTO v_housing, v_transport, v_other
    FROM public.allowance_types at
    LEFT JOIN public.compensation_policy cp
      ON cp.tenant_id = at.tenant_id
      AND cp.allowance_type_id = at.id
      AND cp.position = v_pos
      AND cp.employment_type = v_emp
      AND cp.shift = v_shift
    WHERE at.tenant_id = p_tenant_id
      AND at.is_active = true;
  END IF;

  SELECT hps.default_welfare_deduction_rate
  INTO v_welfare
  FROM public.hr_payroll_settings hps
  WHERE hps.tenant_id = p_tenant_id
    AND hps.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT hps.default_welfare_deduction_rate
    INTO v_welfare
    FROM public.hr_payroll_settings hps
    WHERE hps.tenant_id = p_tenant_id
      AND hps.business_unit_id IS NULL
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_basic, v_housing, v_transport, v_other, v_welfare;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_employees_finance_admin_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expected record;
BEGIN
  IF current_user_role() IS DISTINCT FROM 'finance_admin'::app_role THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS NOT NULL
    OR nullif(btrim(NEW.bank_name), '') IS NOT NULL
    OR nullif(btrim(NEW.account_number), '') IS NOT NULL
    OR nullif(btrim(NEW.momo_number), '') IS NOT NULL
    OR nullif(btrim(NEW.momo_name), '') IS NOT NULL
  THEN
    RAISE EXCEPTION
      'Finance & Admin Officer cannot set employee payment details. Ask an HR officer or director.';
  END IF;

  SELECT *
  INTO v_expected
  FROM public.finance_admin_expected_employee_pay(
    NEW.tenant_id,
    NEW.business_unit_id,
    NEW.position,
    NEW.employment_type,
    NEW.shift
  );

  IF NOT public.finance_admin_employee_pay_value_allowed(NEW.basic_salary, v_expected.basic_salary)
    OR NOT public.finance_admin_employee_pay_value_allowed(
      NEW.housing_allowance,
      v_expected.housing_allowance
    )
    OR NOT public.finance_admin_employee_pay_value_allowed(
      NEW.transport_allowance,
      v_expected.transport_allowance
    )
    OR NOT public.finance_admin_employee_pay_value_allowed(
      NEW.other_allowances,
      v_expected.other_allowances
    )
    OR NOT public.finance_admin_employee_pay_value_allowed(
      NEW.welfare_deduction_rate,
      v_expected.welfare_deduction_rate
    )
  THEN
    RAISE EXCEPTION 'Pay must follow Salary Settings for this position';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employees_finance_admin_insert_guard ON public.employees;
CREATE TRIGGER trg_employees_finance_admin_insert_guard
  BEFORE INSERT ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_employees_finance_admin_insert_guard();

DROP POLICY IF EXISTS employees_rbac_delete ON public.employees;
CREATE POLICY employees_rbac_delete
  ON public.employees
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_delete_employee_records()
    AND user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS sites_rbac_select ON public.sites;
CREATE POLICY sites_rbac_select
  ON public.sites
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
      OR current_user_role() IN (
        'finance'::app_role,
        'finance_admin'::app_role,
        'hr'::app_role
      )
      OR (
        current_user_role() = 'client'::app_role
        AND client_id = current_user_client_id()
      )
    )
  );

DROP POLICY IF EXISTS projects_client_select ON public.projects;
CREATE POLICY projects_client_select
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN (
        'finance'::app_role,
        'finance_admin'::app_role,
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
    AND user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS roster_config_client_select ON public.roster_config;
CREATE POLICY roster_config_client_select
  ON public.roster_config
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN (
        'operations_manager'::app_role,
        'supervisor'::app_role,
        'finance_admin'::app_role
      )
      OR can_access_client_record(client_id)
    )
    AND tenant_has_feature(tenant_id, 'operations')
    AND user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS roster_history_rbac_select ON public.roster_history;
CREATE POLICY roster_history_rbac_select
  ON public.roster_history
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'hr'::app_role,
        'director'::app_role,
        'finance_admin'::app_role
      )
      OR current_user_role() = 'supervisor'::app_role
      OR employee_id = current_user_employee_id()
    )
  );

DROP POLICY IF EXISTS roster_rotation_metadata_select ON public.roster_rotation_metadata;
CREATE POLICY roster_rotation_metadata_select
  ON public.roster_rotation_metadata
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN (
        'operations_manager'::app_role,
        'supervisor'::app_role,
        'director'::app_role,
        'finance_admin'::app_role
      )
      OR can_access_client_record(client_id)
    )
    AND user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS corrective_actions_rbac_select ON public.corrective_actions;
CREATE POLICY corrective_actions_rbac_select
  ON public.corrective_actions
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'operations_manager'::app_role,
        'director'::app_role,
        'finance_admin'::app_role
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
    AND user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS work_orders_rbac_select ON public.work_orders;
CREATE POLICY work_orders_rbac_select
  ON public.work_orders
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_operations_site_for_read(site_id)
    AND tenant_has_feature(tenant_id, 'operations')
  );

DROP POLICY IF EXISTS manual_financial_entries_tenant_write ON public.manual_financial_entries;
CREATE POLICY manual_financial_entries_tenant_write
  ON public.manual_financial_entries
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
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
      'finance_admin'::app_role,
      'director'::app_role
    )
    AND user_has_business_unit_access(business_unit_id)
  );

CREATE OR REPLACE FUNCTION public.can_access_pos_held_carts()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN (
    'super_admin'::public.app_role,
    'finance'::public.app_role,
    'finance_admin'::public.app_role,
    'hr'::public.app_role,
    'director'::public.app_role,
    'sales_rep'::public.app_role
  );
$$;

DROP POLICY IF EXISTS complaint_register_rbac_select ON public.complaint_register;
CREATE POLICY complaint_register_rbac_select
  ON public.complaint_register
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_operations_site_for_read(site_id)
    AND tenant_has_feature(tenant_id, 'operations')
  );

DROP POLICY IF EXISTS failed_inspections_rbac_select ON public.failed_inspections;
CREATE POLICY failed_inspections_rbac_select
  ON public.failed_inspections
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_operations_site_for_read(site_id)
    AND tenant_has_feature(tenant_id, 'operations')
  );

DROP POLICY IF EXISTS incident_register_rbac_select ON public.incident_register;
CREATE POLICY incident_register_rbac_select
  ON public.incident_register
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_operations_site_for_read(site_id)
    AND tenant_has_feature(tenant_id, 'operations')
  );

DROP POLICY IF EXISTS inspection_summary_rbac_select ON public.inspection_summary;
CREATE POLICY inspection_summary_rbac_select
  ON public.inspection_summary
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_operations_site_for_read(site_id)
    AND tenant_has_feature(tenant_id, 'operations')
  );

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
    'finance_admin'::app_role,
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
    'finance_admin'::app_role,
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
    'finance_admin'::app_role,
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

DROP POLICY IF EXISTS directors_loan_entries_tenant_insert ON public.directors_loan_entries;
CREATE POLICY directors_loan_entries_tenant_insert
  ON public.directors_loan_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS directors_loan_entries_tenant_update ON public.directors_loan_entries;
CREATE POLICY directors_loan_entries_tenant_update
  ON public.directors_loan_entries
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'finance_admin'::app_role,
      'director'::app_role
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
