-- Script 292: Staff welfare fund payroll lock wiring + DEDSAV welfare removal.
-- Prerequisite: script 291 (staff_welfare_fund_ledger).
-- Forward-only: new locks accrue welfare to staff_welfare_fund_ledger; welfare no
-- longer feeds PAYROLL-DEDSAV Other Income.
--
-- Also fixes cross-BU deletion/sync bugs in payroll statutory tax ledger teardown
-- (279-era): delete and re-lock paths now scope by business_unit_id using
-- IS NOT DISTINCT FROM (no-op for legacy single-BU tenants with NULL BU everywhere).
--
-- KNOWN SEPARATE ISSUE (not fixed here): _delete_payroll_lock_finance expense_register
-- and income_register teardown remains tenant-wide (receipt_no / description by month).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. DEDSAV total excludes welfare (liability accrues separately)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._payroll_deduction_savings_total(p_rows jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._payroll_round_currency(
    coalesce(
      (
        SELECT sum(
          coalesce((elem ->> 'absence_deduction')::numeric, 0)
          + coalesce((elem ->> 'loan_repayment')::numeric, 0)
          + coalesce((elem ->> 'salary_advance')::numeric, 0)
          + coalesce((elem ->> 'other_deductions')::numeric, 0)
        )
        FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      ),
      0
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Welfare fund accrual sync (one row per tenant/BU/payroll period)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._payroll_sync_welfare_fund_accrual(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_period_end date,
  p_month_label text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_welfare numeric;
  v_source_id text;
  v_period_month date;
  v_existing record;
  v_action text := 'unchanged';
BEGIN
  v_welfare := public._payroll_sum_jsonb_field(p_rows, 'welfare_deduction');
  v_source_id := public._payroll_tax_ledger_source_id(p_payroll_month)::text;
  v_period_month := date_trunc('month', p_period_end)::date;

  SELECT id, status, amount
  INTO v_existing
  FROM public.staff_welfare_fund_ledger
  WHERE tenant_id = p_tenant_id
    AND source_type = 'payroll_period'
    AND source_id = v_source_id
    AND entry_type = 'accrual'
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF FOUND AND v_existing.status <> 'open' THEN
    RETURN jsonb_build_object(
      'sourceId', v_source_id,
      'action', 'skipped_settled',
      'amount', v_welfare
    );
  END IF;

  IF coalesce(v_welfare, 0) <= 0 THEN
    IF FOUND AND v_existing.status = 'open' THEN
      DELETE FROM public.staff_welfare_fund_ledger
      WHERE id = v_existing.id
        AND status = 'open';
      v_action := 'delete';
    END IF;

    RETURN jsonb_build_object(
      'sourceId', v_source_id,
      'action', v_action,
      'amount', 0
    );
  END IF;

  IF FOUND THEN
    IF public._payroll_round_currency(v_existing.amount) IS DISTINCT FROM public._payroll_round_currency(v_welfare) THEN
      UPDATE public.staff_welfare_fund_ledger
      SET
        entry_date = p_period_end,
        period_month = v_period_month,
        amount = v_welfare,
        counterparty_name = 'Staff Welfare Fund',
        notes = 'Payroll welfare accrual — ' || p_month_label,
        updated_at = now()
      WHERE id = v_existing.id
        AND status = 'open';
      v_action := 'update';
    END IF;
  ELSE
    INSERT INTO public.staff_welfare_fund_ledger (
      tenant_id,
      business_unit_id,
      entry_date,
      period_month,
      entry_type,
      amount,
      status,
      source_type,
      source_id,
      employee_id,
      counterparty_name,
      notes
    )
    VALUES (
      p_tenant_id,
      p_business_unit_id,
      p_period_end,
      v_period_month,
      'accrual',
      v_welfare,
      'open',
      'payroll_period',
      v_source_id,
      NULL,
      'Staff Welfare Fund',
      'Payroll welfare accrual — ' || p_month_label
    );
    v_action := 'insert';
  END IF;

  RETURN jsonb_build_object(
    'sourceId', v_source_id,
    'action', v_action,
    'amount', v_welfare
  );
END;
$$;

DROP FUNCTION IF EXISTS public._payroll_delete_open_welfare_fund_accrual(uuid, date);

CREATE OR REPLACE FUNCTION public._payroll_delete_open_welfare_fund_accrual(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id text;
  v_deleted integer;
BEGIN
  v_source_id := public._payroll_tax_ledger_source_id(p_payroll_month)::text;

  DELETE FROM public.staff_welfare_fund_ledger
  WHERE tenant_id = p_tenant_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND source_type = 'payroll_period'
    AND source_id = v_source_id
    AND entry_type = 'accrual'
    AND status = 'open';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Statutory tax ledger BU-scoped sync + delete (279-era fix)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._payroll_sync_statutory_tax_ledger(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_period_end date,
  p_month_label text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id uuid;
  v_period_month date;
  v_paye numeric;
  v_employee_ssnit numeric;
  v_employer_tier1 numeric;
  v_tier2 numeric;
  v_open record;
  v_paid_or_filed boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_deleted integer := 0;
  v_skipped_paid integer := 0;
  v_leg record;
BEGIN
  v_source_id := public._payroll_tax_ledger_source_id(p_payroll_month);
  v_period_month := date_trunc('month', p_period_end)::date;

  v_paye := public._payroll_sum_jsonb_field(p_rows, 'paye_tax');
  v_employee_ssnit := public._payroll_sum_jsonb_field(p_rows, 'employee_ssnit');
  v_employer_tier1 := public._payroll_sum_jsonb_field(p_rows, 'employer_ssnit');
  v_tier2 := public._payroll_sum_jsonb_field(p_rows, 'tier2');

  CREATE TEMP TABLE _payroll_desired_legs (
    tax_component text PRIMARY KEY,
    tax_amount numeric NOT NULL,
    counterparty_name text NOT NULL
  ) ON COMMIT DROP;

  IF v_paye > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('paye', v_paye, 'GRA');
  END IF;
  IF v_employee_ssnit > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_employee', v_employee_ssnit, 'SSNIT');
  END IF;
  IF v_employer_tier1 > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_employer_tier1', v_employer_tier1, 'SSNIT');
  END IF;
  IF v_tier2 > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_tier2', v_tier2, 'SSNIT');
  END IF;

  CREATE TEMP TABLE _payroll_open_legs (
    id uuid PRIMARY KEY,
    tax_component text NOT NULL,
    tax_amount numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _payroll_open_legs (id, tax_component, tax_amount)
  SELECT id, tax_component, tax_amount
  FROM tax_ledger_entries
  WHERE tenant_id = p_tenant_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND source_type = 'payroll_period'
    AND source_id = v_source_id::text
    AND status = 'open';

  FOR v_leg IN SELECT * FROM _payroll_desired_legs LOOP
    SELECT EXISTS (
      SELECT 1
      FROM tax_ledger_entries
      WHERE tenant_id = p_tenant_id
        AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        AND source_type = 'payroll_period'
        AND source_id = v_source_id::text
        AND tax_component = v_leg.tax_component
        AND status <> 'open'
        AND status <> 'reversed'
    ) INTO v_paid_or_filed;

    IF v_paid_or_filed THEN
      v_skipped_paid := v_skipped_paid + 1;
      DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
      CONTINUE;
    END IF;

    SELECT * INTO v_open
    FROM _payroll_open_legs
    WHERE tax_component = v_leg.tax_component;

    IF FOUND THEN
      IF public._payroll_round_currency(v_open.tax_amount) = public._payroll_round_currency(v_leg.tax_amount) THEN
        DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
        CONTINUE;
      END IF;

      UPDATE tax_ledger_entries
      SET
        entry_date = p_period_end,
        period_month = v_period_month,
        taxable_base = v_leg.tax_amount,
        tax_amount = v_leg.tax_amount,
        counterparty_name = v_leg.counterparty_name,
        notes = 'Payroll statutory accrual — ' || p_month_label,
        updated_at = now()
      WHERE id = v_open.id
        AND status = 'open';

      v_updated := v_updated + 1;
      DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
      CONTINUE;
    END IF;

    INSERT INTO tax_ledger_entries (
      tenant_id,
      entry_date,
      period_month,
      direction,
      tax_component,
      rate_pct,
      taxable_base,
      tax_amount,
      status,
      source_type,
      source_id,
      counterparty_name,
      notes,
      business_unit_id
    ) VALUES (
      p_tenant_id,
      p_period_end,
      v_period_month,
      'statutory_payable',
      v_leg.tax_component,
      NULL,
      v_leg.tax_amount,
      v_leg.tax_amount,
      'open',
      'payroll_period',
      v_source_id::text,
      v_leg.counterparty_name,
      'Payroll statutory accrual — ' || p_month_label,
      p_business_unit_id
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  DELETE FROM tax_ledger_entries t
  USING _payroll_open_legs o
  WHERE t.id = o.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'sourceId', v_source_id::text,
    'inserted', v_inserted,
    'updated', v_updated,
    'deleted', v_deleted,
    'skippedPaid', v_skipped_paid
  );
END;
$$;

DROP FUNCTION IF EXISTS public._payroll_delete_open_statutory_tax_ledger(uuid, date);

CREATE OR REPLACE FUNCTION public._payroll_delete_open_statutory_tax_ledger(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id uuid;
  v_deleted integer;
BEGIN
  v_source_id := public._payroll_tax_ledger_source_id(p_payroll_month);

  DELETE FROM tax_ledger_entries
  WHERE tenant_id = p_tenant_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND source_type = 'payroll_period'
    AND source_id = v_source_id::text
    AND status = 'open';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. DEDSAV copy no longer mentions welfare
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._payroll_upsert_deduction_savings_income(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_period_end date,
  p_period_key text,
  p_month_label text,
  p_amount numeric
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_no text;
  v_description text;
  v_existing record;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN
    RETURN 'skipped_zero';
  END IF;

  v_invoice_no := public._payroll_expense_receipt_no('DEDSAV', p_period_key);
  v_description :=
    'Auto-posted from Payroll ' || p_month_label
    || ' - Deduction Savings (absence/loan/advance/other)';

  SELECT id, amount, service_category, description
  INTO v_existing
  FROM income_register
  WHERE tenant_id = p_tenant_id
    AND invoice_no = v_invoice_no
  LIMIT 1;

  IF FOUND THEN
    IF public._payroll_round_currency(v_existing.amount) IS DISTINCT FROM public._payroll_round_currency(p_amount)
       OR v_existing.service_category IS DISTINCT FROM 'Other Income'
       OR v_existing.description IS DISTINCT FROM v_description THEN
      UPDATE income_register
      SET
        date = p_period_end,
        due_date = p_period_end,
        customer_name = 'Payroll',
        client_id = NULL,
        entry_type = 'service',
        service_category = 'Other Income',
        description = v_description,
        amount = p_amount,
        amount_received = 0,
        outstanding_balance = 0,
        payment_status = 'Unpaid',
        notes = 'Non-cash payroll deduction savings (absence/loan/advance/other); auto-posted on payroll lock.',
        tax_inclusive = true,
        net_of_tax_amount = p_amount,
        output_vat_amount = 0,
        output_tax_component = NULL,
        wht_rate = NULL,
        wht_amount = 0,
        is_system_adjustment = true,
        business_unit_id = p_business_unit_id
      WHERE id = v_existing.id;
      RETURN 'updated';
    END IF;
    RETURN 'unchanged';
  END IF;

  INSERT INTO income_register (
    tenant_id,
    business_unit_id,
    date,
    due_date,
    invoice_no,
    customer_name,
    client_id,
    entry_type,
    service_category,
    description,
    amount,
    amount_received,
    outstanding_balance,
    payment_status,
    notes,
    tax_inclusive,
    net_of_tax_amount,
    output_vat_amount,
    output_tax_component,
    wht_rate,
    wht_amount,
    is_system_adjustment
  )
  VALUES (
    p_tenant_id,
    p_business_unit_id,
    p_period_end,
    p_period_end,
    v_invoice_no,
    'Payroll',
    NULL,
    'service',
    'Other Income',
    v_description,
    p_amount,
    0,
    0,
    'Unpaid',
    'Non-cash payroll deduction savings (absence/loan/advance/other); auto-posted on payroll lock.',
    true,
    p_amount,
    0,
    NULL,
    NULL,
    0,
    true
  );

  RETURN 'inserted';
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Wire welfare accrual into payroll lock / reopen
-- ---------------------------------------------------------------------------
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
  v_deduction_savings := public._payroll_deduction_savings_total(p_rows);

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
    'staffSalariesAlreadyPaid', v_staff_already_paid,
    'insertedPayables', 0,
    'statutoryLedger', v_statutory,
    'welfareFundAccrual', v_welfare
  );
END;
$$;

DROP FUNCTION IF EXISTS public._delete_payroll_lock_finance(uuid, date, integer, integer, jsonb);

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
BEGIN
  v_month_label := public._payroll_month_label(p_period_year, p_period_month);
  v_description := 'Auto-posted from Payroll ' || v_month_label;
  v_period_key := public._payroll_period_key(p_payroll_month);
  v_deduction_invoice := public._payroll_expense_receipt_no('DEDSAV', v_period_key);

  v_reversed_loans := public._payroll_reverse_loan_repayments(p_tenant_id, p_loan_rows);

  -- KNOWN ISSUE: expense/income teardown below is still tenant-wide (not BU-scoped).
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
    'reversedLoans', v_reversed_loans
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_open_period_core(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_year integer;
  v_month integer;
  v_finance_rows jsonb;
  v_finance_result jsonb;
  v_restore jsonb;
  v_close_record jsonb;
  v_total_net_pay numeric;
BEGIN
  v_year := coalesce(
    p_period_year,
    extract(year FROM p_payroll_month)::integer
  );
  v_month := coalesce(
    p_period_month,
    extract(month FROM p_payroll_month)::integer
  );

  v_finance_rows := public._payroll_history_rows_to_jsonb(
    p_tenant_id,
    p_payroll_month,
    p_employee_ids
  );

  v_finance_result := public._delete_payroll_lock_finance(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    v_year,
    v_month,
    v_finance_rows
  );

  v_restore := public._payroll_restore_processing_from_history(
    p_tenant_id,
    p_payroll_month,
    p_employee_ids
  );

  v_total_net_pay := coalesce((v_restore ->> 'totalNetPay')::numeric, 0);

  PERFORM public.admin_delete_payroll_history_for_employees(
    p_payroll_month,
    p_tenant_id,
    p_employee_ids
  );

  INSERT INTO month_end_close (
    tenant_id,
    month,
    business_unit_id,
    employees_recorded,
    total_net_pay,
    lock_status,
    notes
  ) VALUES (
    p_tenant_id,
    p_payroll_month,
    p_business_unit_id,
    coalesce((v_restore ->> 'restoredRows')::integer, 0),
    v_total_net_pay,
    'Open',
    NULL
  )
  ON CONFLICT (tenant_id, business_unit_id, month) DO UPDATE
  SET
    employees_recorded = EXCLUDED.employees_recorded,
    total_net_pay = EXCLUDED.total_net_pay,
    lock_status = EXCLUDED.lock_status,
    notes = EXCLUDED.notes;

  SELECT to_jsonb(m.*)
  INTO v_close_record
  FROM month_end_close m
  WHERE m.tenant_id = p_tenant_id
    AND m.month = p_payroll_month
    AND m.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'closeRecord', v_close_record,
    'financeResult', v_finance_result,
    'restoredRows', coalesce((v_restore ->> 'restoredRows')::integer, 0)
  );
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
