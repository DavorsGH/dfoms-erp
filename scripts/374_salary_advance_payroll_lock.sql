BEGIN;

DROP FUNCTION IF EXISTS public._payroll_deduction_savings_total(jsonb);

CREATE OR REPLACE FUNCTION public._payroll_deduction_savings_total(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_rows jsonb
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public._payroll_round_currency(
    coalesce(
      (
        SELECT sum(
          coalesce((elem ->> 'absence_deduction')::numeric, 0)
          + coalesce((elem ->> 'loan_repayment')::numeric, 0)
          + coalesce((elem ->> 'other_deductions')::numeric, 0)
          + greatest(
              0,
              coalesce((elem ->> 'salary_advance')::numeric, 0)
              - coalesce(
                  (
                    SELECT sum(sar.amount)
                    FROM public.salary_advance_register sar
                    WHERE sar.tenant_id = p_tenant_id
                      AND sar.employee_id = trim(elem ->> 'employee_id')
                      AND sar.deduct_payroll_month = p_payroll_month
                      AND sar.status = 'outstanding'
                      AND sar.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
                  ),
                  0
                )
            )
        )
        FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      ),
      0
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._payroll_mark_salary_advances_deducted(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.salary_advance_register sar
  SET
    status = 'deducted',
    deducted_at = now(),
    payroll_month_locked = p_payroll_month,
    updated_at = now()
  WHERE sar.tenant_id = p_tenant_id
    AND sar.deduct_payroll_month = p_payroll_month
    AND sar.status = 'outstanding'
    AND sar.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND sar.employee_id IN (
      SELECT DISTINCT trim(elem ->> 'employee_id')
      FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      WHERE trim(coalesce(elem ->> 'employee_id', '')) <> ''
        AND public._payroll_round_currency(
          coalesce((elem ->> 'salary_advance')::numeric, 0)
        ) > 0
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_reverse_salary_advances_deducted(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reversed integer := 0;
BEGIN
  UPDATE public.salary_advance_register sar
  SET
    status = 'outstanding',
    deducted_at = NULL,
    payroll_month_locked = NULL,
    updated_at = now()
  WHERE sar.tenant_id = p_tenant_id
    AND sar.payroll_month_locked = p_payroll_month
    AND sar.status = 'deducted'
    AND sar.business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  GET DIAGNOSTICS v_reversed = ROW_COUNT;
  RETURN v_reversed;
END;
$$;

CREATE OR REPLACE FUNCTION public._post_payroll_lock_finance(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer,
  p_rows jsonb,
  p_mark_staff_salaries_paid boolean,
  p_skip_loan_repayments boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_end date;
  v_period_key text;
  v_month_label text;
  v_gross numeric;
  v_employer_ssnit numeric;
  v_deduction_savings numeric;
  v_staff_status text;
  v_sal_action text;
  v_essnit_action text;
  v_income_action text;
  v_inserted_expenses integer := 0;
  v_updated_expenses integer := 0;
  v_inserted_income integer := 0;
  v_updated_income integer := 0;
  v_updated_loans integer := 0;
  v_updated_advances integer := 0;
  v_staff_already_paid boolean := false;
  v_statutory jsonb;
  v_welfare jsonb;
BEGIN
  v_period_end := public._payroll_period_end_date(p_period_year, p_period_month);
  v_period_key := public._payroll_period_key(p_payroll_month);
  v_month_label := public._payroll_month_label(p_period_year, p_period_month);

  v_gross := public._payroll_sum_jsonb_field(p_rows, 'gross_pay');
  v_employer_ssnit := public._payroll_round_currency(
    public._payroll_sum_jsonb_field(p_rows, 'employer_ssnit')
    + public._payroll_sum_jsonb_field(p_rows, 'tier2')
  );
  v_deduction_savings := public._payroll_deduction_savings_total(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    p_rows
  );

  v_staff_status := CASE
    WHEN p_mark_staff_salaries_paid THEN 'Paid'
    ELSE 'Accrued - Not Yet Paid'
  END;

  IF v_gross > 0 THEN
    v_sal_action := public._payroll_upsert_lock_expense(
      p_tenant_id,
      p_business_unit_id,
      v_period_end,
      v_period_key,
      v_month_label,
      'Staff Salaries',
      v_gross,
      'Payroll',
      'SAL',
      v_staff_status
    );
    IF v_sal_action = 'inserted' THEN
      v_inserted_expenses := v_inserted_expenses + 1;
    ELSIF v_sal_action = 'updated' THEN
      v_updated_expenses := v_updated_expenses + 1;
    ELSIF v_sal_action = 'skipped_already_paid' THEN
      v_staff_already_paid := true;
    END IF;
  END IF;

  IF v_employer_ssnit > 0 THEN
    v_essnit_action := public._payroll_upsert_lock_expense(
      p_tenant_id,
      p_business_unit_id,
      v_period_end,
      v_period_key,
      v_month_label,
      'Employer SSNIT Contribution',
      v_employer_ssnit,
      'SSNIT',
      'ESSNIT',
      'Accrued - Not Yet Paid'
    );
    IF v_essnit_action = 'inserted' THEN
      v_inserted_expenses := v_inserted_expenses + 1;
    ELSIF v_essnit_action = 'updated' THEN
      v_updated_expenses := v_updated_expenses + 1;
    END IF;
  END IF;

  IF v_deduction_savings > 0 THEN
    v_income_action := public._payroll_upsert_deduction_savings_income(
      p_tenant_id,
      p_business_unit_id,
      v_period_end,
      v_period_key,
      v_month_label,
      v_deduction_savings
    );
    IF v_income_action = 'inserted' THEN
      v_inserted_income := v_inserted_income + 1;
    ELSIF v_income_action = 'updated' THEN
      v_updated_income := v_updated_income + 1;
    END IF;
  END IF;

  IF NOT p_skip_loan_repayments THEN
    v_updated_loans := public._payroll_apply_loan_repayments(p_tenant_id, p_rows);
  END IF;

  v_updated_advances := public._payroll_mark_salary_advances_deducted(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    p_rows
  );

  v_statutory := public._payroll_sync_statutory_tax_ledger(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    v_period_end,
    v_month_label,
    p_rows
  );

  v_welfare := public._payroll_sync_welfare_fund_accrual(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    v_period_end,
    v_month_label,
    p_rows
  );

  RETURN jsonb_build_object(
    'insertedExpenses', v_inserted_expenses,
    'updatedExpenses', v_updated_expenses,
    'insertedIncome', v_inserted_income,
    'updatedIncome', v_updated_income,
    'updatedLoans', v_updated_loans,
    'updatedSalaryAdvances', v_updated_advances,
    'staffSalariesAlreadyPaid', v_staff_already_paid,
    'insertedPayables', 0,
    'statutoryLedger', v_statutory,
    'welfareFundAccrual', v_welfare
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._delete_payroll_lock_finance(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer,
  p_loan_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month_label text;
  v_description text;
  v_period_key text;
  v_deduction_invoice text;
  v_deleted_expenses integer := 0;
  v_deleted_income integer := 0;
  v_deleted_payables integer := 0;
  v_deleted_statutory integer := 0;
  v_deleted_welfare integer := 0;
  v_reversed_loans integer := 0;
  v_reversed_advances integer := 0;
BEGIN
  v_month_label := public._payroll_month_label(p_period_year, p_period_month);
  v_description := 'Auto-posted from Payroll ' || v_month_label;
  v_period_key := public._payroll_period_key(p_payroll_month);
  v_deduction_invoice := public._payroll_expense_receipt_no('DEDSAV', v_period_key);

  v_reversed_advances := public._payroll_reverse_salary_advances_deducted(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month
  );

  v_reversed_loans := public._payroll_reverse_loan_repayments(p_tenant_id, p_loan_rows);

  DELETE FROM expense_register
  WHERE tenant_id = p_tenant_id
    AND description ILIKE '%' || v_description || '%';
  GET DIAGNOSTICS v_deleted_expenses = ROW_COUNT;

  WITH income_targets AS (
    SELECT id FROM income_register
    WHERE tenant_id = p_tenant_id
      AND invoice_no = v_deduction_invoice
    UNION
    SELECT id FROM income_register
    WHERE tenant_id = p_tenant_id
      AND description ILIKE '%' || v_description || '%'
  )
  DELETE FROM income_register i
  USING income_targets t
  WHERE i.id = t.id;
  GET DIAGNOSTICS v_deleted_income = ROW_COUNT;

  DELETE FROM accounts_payable
  WHERE tenant_id = p_tenant_id
    AND description ILIKE '%' || v_month_label || '%'
    AND vendor_name IN ('SSNIT', 'GRA');
  GET DIAGNOSTICS v_deleted_payables = ROW_COUNT;

  v_deleted_statutory := public._payroll_delete_open_statutory_tax_ledger(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month
  );

  v_deleted_welfare := public._payroll_delete_open_welfare_fund_accrual(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month
  );

  RETURN jsonb_build_object(
    'deletedExpenses', v_deleted_expenses,
    'deletedIncome', v_deleted_income,
    'deletedPayables', v_deleted_payables,
    'deletedStatutoryLedger', v_deleted_statutory,
    'deletedWelfareFundAccrual', v_deleted_welfare,
    'reversedLoans', v_reversed_loans,
    'reversedSalaryAdvances', v_reversed_advances
  );
END;
$$;

INSERT INTO public.leave_types (tenant_id, type_name, default_annual_entitlement)
SELECT t.id, 'Maternity Leave', 84
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leave_types lt
  WHERE lt.tenant_id = t.id
    AND lt.type_name = 'Maternity Leave'
);

ALTER TABLE public.leave_entitlement_policy
  DROP CONSTRAINT IF EXISTS leave_entitlement_policy_leave_type_check;

ALTER TABLE public.leave_entitlement_policy
  ADD CONSTRAINT leave_entitlement_policy_leave_type_check
  CHECK (
    leave_type = ANY (
      ARRAY[
        'Annual Leave'::text,
        'Sick Leave'::text,
        'Unpaid Leave'::text,
        'Maternity Leave'::text
      ]
    )
  );

INSERT INTO public.leave_entitlement_policy (
  tenant_id,
  "position",
  employment_type,
  leave_type,
  entitled_days
)
SELECT t.id, '__DEFAULT__', '__ALL__', 'Maternity Leave', 84
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leave_entitlement_policy lep
  WHERE lep.tenant_id = t.id
    AND lep."position" = '__DEFAULT__'
    AND lep.employment_type = '__ALL__'
    AND lep.leave_type = 'Maternity Leave'
);

CREATE OR REPLACE FUNCTION public.resolve_leave_entitlement(
  p_tenant_id uuid,
  p_position text,
  p_employment_type text,
  p_leave_type text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_days numeric(8, 2);
  v_leave text := btrim(COALESCE(p_leave_type, ''));
  v_pos text := btrim(COALESCE(p_position, ''));
  v_emp text := btrim(COALESCE(p_employment_type, ''));
BEGIN
  IF p_tenant_id IS NOT NULL AND v_pos <> '' AND v_emp <> '' AND v_leave <> '' THEN
    SELECT lep.entitled_days
    INTO v_days
    FROM public.leave_entitlement_policy lep
    WHERE lep.tenant_id = p_tenant_id
      AND lep."position" = v_pos
      AND lep.employment_type = v_emp
      AND lep.leave_type = v_leave
    LIMIT 1;

    IF FOUND THEN
      RETURN COALESCE(v_days, 0);
    END IF;
  END IF;

  IF p_tenant_id IS NOT NULL AND v_leave <> '' THEN
    SELECT lep.entitled_days
    INTO v_days
    FROM public.leave_entitlement_policy lep
    WHERE lep.tenant_id = p_tenant_id
      AND lep."position" = '__DEFAULT__'
      AND lep.employment_type = '__ALL__'
      AND lep.leave_type = v_leave
    LIMIT 1;

    IF FOUND THEN
      RETURN COALESCE(v_days, 0);
    END IF;
  END IF;

  IF v_leave = 'Annual Leave' THEN
    RETURN 15;
  END IF;

  IF v_leave = 'Maternity Leave' THEN
    RETURN 84;
  END IF;

  RETURN 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_leave_balances_for_year(
  p_year integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_year integer := COALESCE(p_year, v_current_year);
  v_employee_id text := current_user_employee_id();
  v_tenant_id uuid := current_user_tenant_id();
  v_employee employees%ROWTYPE;
  v_lt RECORD;
  v_entitled numeric(8, 2);
  v_inserted integer := 0;
BEGIN
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Your user account is not linked to an employee record';
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Your user account has no tenant context';
  END IF;

  IF v_year < v_current_year - 1 OR v_year > v_current_year + 1 THEN
    RAISE EXCEPTION 'Year % is outside the allowed range (% .. %)',
      v_year, v_current_year - 1, v_current_year + 1;
  END IF;

  SELECT *
  INTO v_employee
  FROM employees
  WHERE employee_id = v_employee_id
    AND tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee % not found in your tenant', v_employee_id;
  END IF;

  PERFORM public.assert_caller_can_act_for_tenant(v_tenant_id);

  FOR v_lt IN
    SELECT lt.id, lt.type_name
    FROM leave_types lt
    WHERE lt.tenant_id = v_tenant_id
    ORDER BY lt.type_name
  LOOP
    v_entitled := public.resolve_leave_entitlement(
      v_tenant_id,
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
    SELECT
      v_tenant_id,
      v_employee.employee_id,
      v_lt.id,
      v_year,
      v_entitled,
      0
    WHERE NOT EXISTS (
      SELECT 1
      FROM employee_leave_balances elb
      WHERE elb.tenant_id = v_tenant_id
        AND elb.employee_id = v_employee.employee_id
        AND elb.leave_type_id = v_lt.id
        AND elb.year = v_year
    );

    IF FOUND THEN
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_leave_request__impl(
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_reason text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_employee_id TEXT;
  v_days NUMERIC(8, 2);
  v_approver UUID;
  v_year INTEGER;
  v_remaining NUMERIC(8, 2);
  v_exceeds BOOLEAN := false;
  v_request_id UUID;
BEGIN
  v_employee_id := current_user_employee_id();
  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Your user account is not linked to an employee record';
  END IF;

  v_days := calculate_leave_days(p_start_date, p_end_date);
  IF v_days <= 0 THEN
    RAISE EXCEPTION 'Invalid leave date range';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM leave_requests lr
    WHERE lr.employee_id = v_employee_id
      AND lr.status IN ('Pending', 'Approved')
      AND daterange(lr.start_date, lr.end_date, '[]')
        && daterange(p_start_date, p_end_date, '[]')
  ) THEN
    RAISE EXCEPTION
      'These dates overlap an existing leave request. Choose different dates or cancel the other request first.';
  END IF;

  v_approver := current_leave_approver_auth_uid();
  IF v_approver IS NULL THEN
    RAISE EXCEPTION 'No leave approver is configured';
  END IF;

  v_year := EXTRACT(YEAR FROM p_start_date)::INTEGER;

  SELECT days_remaining
  INTO v_remaining
  FROM employee_leave_balances
  WHERE employee_id = v_employee_id
    AND leave_type_id = p_leave_type_id
    AND year = v_year;

  IF v_remaining IS NOT NULL AND v_days > v_remaining THEN
    v_exceeds := true;
  END IF;

  INSERT INTO leave_requests (
    employee_id,
    leave_type_id,
    start_date,
    end_date,
    days_requested,
    reason,
    status,
    approver_user_account_id,
    exceeds_balance
  )
  VALUES (
    v_employee_id,
    p_leave_type_id,
    p_start_date,
    p_end_date,
    v_days,
    NULLIF(TRIM(p_reason), ''),
    'Pending',
    v_approver,
    v_exceeds
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

COMMIT;
