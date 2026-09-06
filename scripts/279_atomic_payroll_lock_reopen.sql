-- Atomic payroll lock / promote / reopen (Option: single-transaction RPCs).
-- Finance helpers mirror app/dashboard/hr-payroll/payroll-lock-finance-utils.ts
-- and payroll-statutory-ledger-sync.ts (formulas unchanged; atomicity only).

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared helpers (private — not granted to callers)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._payroll_round_currency(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(coalesce(p_value, 0)::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._payroll_period_key(p_payroll_month date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_char(p_payroll_month, 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public._payroll_period_end_date(p_year integer, p_month integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (date_trunc('month', make_date(p_year, p_month, 1)) + interval '1 month - 1 day')::date;
$$;

CREATE OR REPLACE FUNCTION public._payroll_month_label(p_year integer, p_month integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(to_char(make_date(p_year, p_month, 1), 'FMMonth YYYY'));
$$;

CREATE OR REPLACE FUNCTION public._payroll_is_month_ended(p_year integer, p_month integer)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT current_date >= public._payroll_period_end_date(p_year, p_month);
$$;

CREATE OR REPLACE FUNCTION public._payroll_tax_ledger_source_id(p_payroll_month date)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_ymd text;
BEGIN
  v_ymd := to_char(p_payroll_month, 'YYYYMMDD');
  IF v_ymd !~ '^\d{8}$' THEN
    RAISE EXCEPTION 'Invalid payroll month for tax ledger source_id: %', p_payroll_month;
  END IF;
  RETURN ('a11ce000-0000-5000-8000-0000' || v_ymd)::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_expense_receipt_no(
  p_suffix text,
  p_period_key text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'PAYROLL-' || p_suffix || '-' || p_period_key;
$$;

CREATE OR REPLACE FUNCTION public._payroll_sum_jsonb_field(
  p_rows jsonb,
  p_field text
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._payroll_round_currency(
    coalesce(
      (
        SELECT sum(coalesce((elem ->> p_field)::numeric, 0))
        FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      ),
      0
    )
  );
$$;

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
          + coalesce((elem ->> 'welfare_deduction')::numeric, 0)
          + coalesce((elem ->> 'other_deductions')::numeric, 0)
        )
        FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      ),
      0
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._payroll_upsert_lock_expense(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_period_end date,
  p_period_key text,
  p_month_label text,
  p_expense_category text,
  p_amount numeric,
  p_vendor text,
  p_receipt_suffix text,
  p_payment_status text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_no text;
  v_description text;
  v_existing record;
  v_existing_paid boolean;
  v_target_paid boolean;
BEGIN
  IF coalesce(p_amount, 0) <= 0 THEN
    RETURN 'skipped_zero';
  END IF;

  v_receipt_no := public._payroll_expense_receipt_no(p_receipt_suffix, p_period_key);
  v_description := 'Auto-posted from Payroll ' || p_month_label;

  SELECT id, expense_category, payment_status, amount
  INTO v_existing
  FROM expense_register
  WHERE tenant_id = p_tenant_id
    AND receipt_no = v_receipt_no
  LIMIT 1;

  v_existing_paid := lower(trim(coalesce(v_existing.payment_status, ''))) = 'paid';
  v_target_paid := lower(trim(coalesce(p_payment_status, ''))) = 'paid';

  IF FOUND THEN
    IF v_existing_paid AND v_target_paid THEN
      IF v_existing.expense_category IS DISTINCT FROM p_expense_category
         OR public._payroll_round_currency(v_existing.amount) IS DISTINCT FROM public._payroll_round_currency(p_amount) THEN
        UPDATE expense_register
        SET
          date = p_period_end,
          expense_category = p_expense_category,
          sub_category = 'Payroll',
          description = v_description,
          vendor = p_vendor,
          price = p_amount,
          quantity = 1,
          amount = p_amount,
          payment_method = 'Accrual',
          business_unit_id = p_business_unit_id
        WHERE id = v_existing.id;
      END IF;
      RETURN 'skipped_already_paid';
    END IF;

    IF v_existing.expense_category IS DISTINCT FROM p_expense_category
       OR v_existing.payment_status IS DISTINCT FROM p_payment_status
       OR public._payroll_round_currency(v_existing.amount) IS DISTINCT FROM public._payroll_round_currency(p_amount) THEN
      UPDATE expense_register
      SET
        date = p_period_end,
        expense_category = p_expense_category,
        sub_category = 'Payroll',
        description = v_description,
        vendor = p_vendor,
        price = p_amount,
        quantity = 1,
        amount = p_amount,
        payment_method = 'Accrual',
        payment_status = p_payment_status,
        business_unit_id = p_business_unit_id
      WHERE id = v_existing.id;
      RETURN 'updated';
    END IF;

    RETURN 'unchanged';
  END IF;

  INSERT INTO expense_register (
    tenant_id,
    date,
    expense_category,
    sub_category,
    description,
    vendor,
    price,
    quantity,
    amount,
    payment_method,
    approved_by,
    receipt_no,
    payment_status,
    notes,
    business_unit_id
  ) VALUES (
    p_tenant_id,
    p_period_end,
    p_expense_category,
    'Payroll',
    v_description,
    p_vendor,
    p_amount,
    1,
    p_amount,
    'Accrual',
    'System',
    v_receipt_no,
    p_payment_status,
    NULL,
    p_business_unit_id
  );

  RETURN 'inserted';
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_upsert_deduction_savings_income(
  p_tenant_id uuid,
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
    || ' - Deduction Savings (absence/loan/advance/welfare/other)';

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
        notes = 'Non-cash payroll deduction savings (absence/loan/advance/welfare/other); auto-posted on payroll lock.',
        tax_inclusive = true,
        net_of_tax_amount = p_amount,
        output_vat_amount = 0,
        output_tax_component = NULL,
        wht_rate = NULL,
        wht_amount = 0,
        is_system_adjustment = true
      WHERE id = v_existing.id;
      RETURN 'updated';
    END IF;
    RETURN 'unchanged';
  END IF;

  INSERT INTO income_register (
    tenant_id,
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
  ) VALUES (
    p_tenant_id,
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
    'Non-cash payroll deduction savings (absence/loan/advance/welfare/other); auto-posted on payroll lock.',
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

CREATE OR REPLACE FUNCTION public._payroll_apply_loan_repayments(
  p_tenant_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_emp record;
  v_loan record;
  v_remaining numeric;
  v_apply numeric;
  v_outstanding numeric;
  v_monthly numeric;
  v_repaid numeric;
  v_next_repaid numeric;
  v_next_outstanding numeric;
  v_updated integer := 0;
BEGIN
  FOR v_emp IN
    SELECT
      trim(elem ->> 'employee_id') AS employee_id,
      public._payroll_round_currency(sum(coalesce((elem ->> 'loan_repayment')::numeric, 0))) AS repayment
    FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
    WHERE trim(coalesce(elem ->> 'employee_id', '')) <> ''
    GROUP BY 1
    HAVING public._payroll_round_currency(sum(coalesce((elem ->> 'loan_repayment')::numeric, 0))) > 0
  LOOP
    v_remaining := v_emp.repayment;

    FOR v_loan IN
      SELECT loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance
      FROM loan_register
      WHERE tenant_id = p_tenant_id
        AND employee_id = v_emp.employee_id
      ORDER BY loan_id
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_outstanding := coalesce(
        v_loan.outstanding_balance,
        greatest(coalesce(v_loan.loan_amount, 0) - coalesce(v_loan.total_repaid_to_date, 0), 0)
      );
      IF v_outstanding <= 0.01 THEN
        CONTINUE;
      END IF;

      v_monthly := greatest(coalesce(v_loan.monthly_deduction, 0), 0);
      v_apply := public._payroll_round_currency(least(v_monthly, v_outstanding, v_remaining));
      IF v_apply <= 0 THEN
        CONTINUE;
      END IF;

      v_next_repaid := public._payroll_round_currency(coalesce(v_loan.total_repaid_to_date, 0) + v_apply);
      v_next_outstanding := greatest(coalesce(v_loan.loan_amount, 0) - v_next_repaid, 0);

      UPDATE loan_register
      SET total_repaid_to_date = v_next_repaid,
          outstanding_balance = v_next_outstanding
      WHERE loan_id = v_loan.loan_id
        AND tenant_id = p_tenant_id;

      v_loan.total_repaid_to_date := v_next_repaid;
      v_loan.outstanding_balance := v_next_outstanding;
      v_remaining := public._payroll_round_currency(v_remaining - v_apply);
      v_updated := v_updated + 1;
    END LOOP;

    IF v_remaining > 0.009 THEN
      FOR v_loan IN
        SELECT loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance
        FROM loan_register
        WHERE tenant_id = p_tenant_id
          AND employee_id = v_emp.employee_id
        ORDER BY loan_id
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_outstanding := greatest(
          coalesce(
            v_loan.outstanding_balance,
            coalesce(v_loan.loan_amount, 0) - coalesce(v_loan.total_repaid_to_date, 0)
          ),
          0
        );
        IF v_outstanding <= 0.01 THEN
          CONTINUE;
        END IF;

        v_apply := public._payroll_round_currency(least(v_outstanding, v_remaining));
        IF v_apply <= 0 THEN
          CONTINUE;
        END IF;

        v_next_repaid := public._payroll_round_currency(coalesce(v_loan.total_repaid_to_date, 0) + v_apply);
        v_next_outstanding := greatest(coalesce(v_loan.loan_amount, 0) - v_next_repaid, 0);

        UPDATE loan_register
        SET total_repaid_to_date = v_next_repaid,
            outstanding_balance = v_next_outstanding
        WHERE loan_id = v_loan.loan_id
          AND tenant_id = p_tenant_id;

        v_loan.total_repaid_to_date := v_next_repaid;
        v_loan.outstanding_balance := v_next_outstanding;
        v_remaining := public._payroll_round_currency(v_remaining - v_apply);
        v_updated := v_updated + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_reverse_loan_repayments(
  p_tenant_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_emp record;
  v_loan record;
  v_remaining numeric;
  v_reverse numeric;
  v_repaid numeric;
  v_monthly numeric;
  v_next_repaid numeric;
  v_next_outstanding numeric;
  v_reversed integer := 0;
BEGIN
  FOR v_emp IN
    SELECT
      trim(elem ->> 'employee_id') AS employee_id,
      public._payroll_round_currency(sum(coalesce((elem ->> 'loan_repayment')::numeric, 0))) AS repayment
    FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
    WHERE trim(coalesce(elem ->> 'employee_id', '')) <> ''
    GROUP BY 1
    HAVING public._payroll_round_currency(sum(coalesce((elem ->> 'loan_repayment')::numeric, 0))) > 0
  LOOP
    v_remaining := v_emp.repayment;

    FOR v_loan IN
      SELECT loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance
      FROM loan_register
      WHERE tenant_id = p_tenant_id
        AND employee_id = v_emp.employee_id
      ORDER BY loan_id
    LOOP
      EXIT WHEN v_remaining <= 0;

      v_repaid := greatest(coalesce(v_loan.total_repaid_to_date, 0), 0);
      IF v_repaid <= 0.01 THEN
        CONTINUE;
      END IF;

      v_monthly := greatest(coalesce(v_loan.monthly_deduction, 0), 0);
      v_reverse := public._payroll_round_currency(least(v_monthly, v_repaid, v_remaining));
      IF v_reverse <= 0 THEN
        CONTINUE;
      END IF;

      v_next_repaid := public._payroll_round_currency(greatest(v_repaid - v_reverse, 0));
      v_next_outstanding := greatest(coalesce(v_loan.loan_amount, 0) - v_next_repaid, 0);

      UPDATE loan_register
      SET total_repaid_to_date = v_next_repaid,
          outstanding_balance = v_next_outstanding
      WHERE loan_id = v_loan.loan_id
        AND tenant_id = p_tenant_id;

      v_loan.total_repaid_to_date := v_next_repaid;
      v_loan.outstanding_balance := v_next_outstanding;
      v_remaining := public._payroll_round_currency(v_remaining - v_reverse);
      v_reversed := v_reversed + 1;
    END LOOP;

    IF v_remaining > 0.009 THEN
      FOR v_loan IN
        SELECT loan_id, employee_id, loan_amount, monthly_deduction, total_repaid_to_date, outstanding_balance
        FROM loan_register
        WHERE tenant_id = p_tenant_id
          AND employee_id = v_emp.employee_id
        ORDER BY loan_id
      LOOP
        EXIT WHEN v_remaining <= 0;

        v_repaid := greatest(coalesce(v_loan.total_repaid_to_date, 0), 0);
        IF v_repaid <= 0.01 THEN
          CONTINUE;
        END IF;

        v_reverse := public._payroll_round_currency(least(v_repaid, v_remaining));
        IF v_reverse <= 0 THEN
          CONTINUE;
        END IF;

        v_next_repaid := public._payroll_round_currency(greatest(v_repaid - v_reverse, 0));
        v_next_outstanding := greatest(coalesce(v_loan.loan_amount, 0) - v_next_repaid, 0);

        UPDATE loan_register
        SET total_repaid_to_date = v_next_repaid,
            outstanding_balance = v_next_outstanding
        WHERE loan_id = v_loan.loan_id
          AND tenant_id = p_tenant_id;

        v_loan.total_repaid_to_date := v_next_repaid;
        v_loan.outstanding_balance := v_next_outstanding;
        v_remaining := public._payroll_round_currency(v_remaining - v_reverse);
        v_reversed := v_reversed + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN v_reversed;
END;
$$;

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
  v_existing record;
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
    AND source_type = 'payroll_period'
    AND source_id = v_source_id::text
    AND status = 'open';

  FOR v_leg IN SELECT * FROM _payroll_desired_legs LOOP
    SELECT EXISTS (
      SELECT 1
      FROM tax_ledger_entries
      WHERE tenant_id = p_tenant_id
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

CREATE OR REPLACE FUNCTION public._payroll_delete_open_statutory_tax_ledger(
  p_tenant_id uuid,
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
    AND source_type = 'payroll_period'
    AND source_id = v_source_id::text
    AND status = 'open';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
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

  RETURN jsonb_build_object(
    'insertedExpenses', v_inserted_expenses,
    'updatedExpenses', v_updated_expenses,
    'insertedIncome', v_inserted_income,
    'updatedIncome', v_updated_income,
    'updatedLoans', v_updated_loans,
    'staffSalariesAlreadyPaid', v_staff_already_paid,
    'insertedPayables', 0,
    'statutoryLedger', v_statutory
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._delete_payroll_lock_finance(
  p_tenant_id uuid,
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
  v_reversed_loans integer := 0;
BEGIN
  v_month_label := public._payroll_month_label(p_period_year, p_period_month);
  v_description := 'Auto-posted from Payroll ' || v_month_label;
  v_period_key := public._payroll_period_key(p_payroll_month);
  v_deduction_invoice := public._payroll_expense_receipt_no('DEDSAV', v_period_key);

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
    p_payroll_month
  );

  RETURN jsonb_build_object(
    'deletedExpenses', v_deleted_expenses,
    'deletedIncome', v_deleted_income,
    'deletedPayables', v_deleted_payables,
    'deletedStatutoryLedger', v_deleted_statutory,
    'reversedLoans', v_reversed_loans
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._promote_payroll_allowance_lines_to_history(
  p_tenant_id uuid,
  p_payroll_month date,
  p_business_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM payroll_allowance_lines
  WHERE tenant_id = p_tenant_id
    AND stage = 'history'
    AND payroll_month = p_payroll_month;

  INSERT INTO payroll_allowance_lines (
    tenant_id,
    stage,
    payroll_month,
    employee_id,
    allowance_type_id,
    allowance_code,
    allowance_name,
    amount,
    business_unit_id
  )
  SELECT
    p_tenant_id,
    'history',
    p_payroll_month,
    employee_id,
    allowance_type_id,
    allowance_code,
    allowance_name,
    coalesce(amount, 0),
    coalesce(business_unit_id, p_business_unit_id)
  FROM payroll_allowance_lines
  WHERE tenant_id = p_tenant_id
    AND stage = 'processing'
    AND payroll_month = p_payroll_month;

  DELETE FROM payroll_allowance_lines
  WHERE tenant_id = p_tenant_id
    AND stage = 'processing'
    AND payroll_month = p_payroll_month;
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_rows_to_finance_jsonb(p_rows jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', elem ->> 'employee_id',
        'gross_pay', elem ->> 'gross_pay',
        'net_only_adjustment', elem ->> 'net_only_adjustment',
        'absence_deduction', elem ->> 'absence_deduction',
        'loan_repayment', elem ->> 'loan_repayment',
        'salary_advance', elem ->> 'salary_advance',
        'welfare_deduction', elem ->> 'welfare_deduction',
        'other_deductions', elem ->> 'other_deductions',
        'employee_ssnit', elem ->> 'employee_ssnit',
        'employer_ssnit', elem ->> 'employer_ssnit',
        'tier2', elem ->> 'tier2',
        'paye_tax', elem ->> 'paye_tax'
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem;
$$;

CREATE OR REPLACE FUNCTION public._payroll_history_rows_to_jsonb(
  p_tenant_id uuid,
  p_payroll_month date,
  p_employee_ids text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', employee_id,
        'gross_pay', gross_pay,
        'net_only_adjustment', net_only_adjustment,
        'absence_deduction', absence_deduction,
        'loan_repayment', loan_repayment,
        'salary_advance', salary_advance,
        'welfare_deduction', welfare_deduction,
        'other_deductions', other_deductions,
        'employee_ssnit', employee_ssnit,
        'employer_ssnit', employer_ssnit,
        'tier2', tier2,
        'paye_tax', paye_tax
      )
    ),
    '[]'::jsonb
  )
  FROM payroll_history
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lock_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer,
  p_lock_status text,
  p_notes text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_existing record;
  v_scoped_rows jsonb := '[]'::jsonb;
  v_history_rows jsonb;
  v_finance_rows jsonb;
  v_locked_at timestamptz := now();
  v_total_net_pay numeric := 0;
  v_year integer;
  v_month integer;
  v_period_end date;
  v_is_promote boolean := false;
  v_is_full_lock boolean;
  v_close_record jsonb;
  v_finance_result jsonb;
  v_previous_employees integer;
  v_elem jsonb;
  v_hist_year integer;
  v_hist_month integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll rows to lock for this period';
  END IF;

  IF p_lock_status NOT IN ('Locked', 'Partially Locked') THEN
    RAISE EXCEPTION 'Invalid lock status';
  END IF;

  v_year := coalesce(
    p_period_year,
    extract(year FROM p_payroll_month)::integer
  );
  v_month := coalesce(
    p_period_month,
    extract(month FROM p_payroll_month)::integer
  );

  SELECT *
  INTO v_existing
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  v_is_promote :=
    v_existing.lock_status = 'Partially Locked'
    AND p_lock_status = 'Locked';

  IF v_is_promote THEN
    IF NOT public._payroll_is_month_ended(v_year, v_month) THEN
      RAISE EXCEPTION
        'Permanent lock is only allowed on or after % ends. Keep the period Partially Locked until then.',
        public._payroll_month_label(v_year, v_month);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM payroll_history
      WHERE tenant_id = p_tenant_id
        AND payroll_month = p_payroll_month
        AND employee_id = ANY (p_employee_ids)
    ) THEN
      RAISE EXCEPTION 'No payroll history rows found for this partially locked period';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM payroll_history
      WHERE tenant_id = p_tenant_id
        AND payroll_month = p_payroll_month
        AND employee_id = ANY (p_employee_ids)
        AND locked IS TRUE
    ) THEN
      RAISE EXCEPTION
        'This period already has permanently locked payroll records. Use Release to Open if needed.';
    END IF;

    v_previous_employees := v_existing.employees_recorded;

    UPDATE payroll_history
    SET locked = true,
        locked_at = v_locked_at
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids);

    SELECT public._payroll_round_currency(coalesce(sum(net_pay), 0))
    INTO v_total_net_pay
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids);

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
      (
        SELECT count(*)
        FROM payroll_history
        WHERE tenant_id = p_tenant_id
          AND payroll_month = p_payroll_month
          AND employee_id = ANY (p_employee_ids)
      ),
      v_total_net_pay,
      'Locked',
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

    v_finance_rows := public._payroll_history_rows_to_jsonb(
      p_tenant_id,
      p_payroll_month,
      p_employee_ids
    );

    v_finance_result := public._post_payroll_lock_finance(
      p_tenant_id,
      p_business_unit_id,
      p_payroll_month,
      v_year,
      v_month,
      v_finance_rows,
      true,
      true
    );

    RETURN jsonb_build_object(
      'closeRecord', v_close_record,
      'financeResult', v_finance_result,
      'promotedFromPartial', true,
      'previousEmployeesRecorded', v_previous_employees
    );
  END IF;

  IF v_existing.lock_status IN ('Locked', 'Partially Locked') THEN
    RAISE EXCEPTION 'This payroll period is already locked';
  END IF;

  FOR v_elem IN
    SELECT elem
    FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
    WHERE trim(coalesce(elem ->> 'employee_id', '')) = ANY (p_employee_ids)
  LOOP
    v_scoped_rows := v_scoped_rows || jsonb_build_array(v_elem);
    v_total_net_pay := public._payroll_round_currency(
      v_total_net_pay + coalesce((v_elem ->> 'net_pay')::numeric, 0)
    );
  END LOOP;

  IF jsonb_array_length(v_scoped_rows) = 0 THEN
    RAISE EXCEPTION 'No payroll rows to lock for this period';
  END IF;

  v_is_full_lock := p_lock_status = 'Locked';

  IF v_is_full_lock AND NOT public._payroll_is_month_ended(v_year, v_month) THEN
    RAISE EXCEPTION
      'Permanent lock is only allowed on or after % ends. Use Partial Lock Period until then.',
      public._payroll_month_label(v_year, v_month);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    IF coalesce(v_existing.lock_status, 'Open') NOT IN ('Open', 'Not Started')
       AND v_existing.lock_status IS NOT NULL THEN
      RAISE EXCEPTION 'This payroll period is already locked';
    END IF;

    PERFORM public.admin_delete_payroll_history_for_employees(
      p_payroll_month,
      p_tenant_id,
      p_employee_ids
    );
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_scoped_rows) LOOP
    v_hist_year := extract(year FROM p_payroll_month)::integer;
    v_hist_month := extract(month FROM p_payroll_month)::integer;

    INSERT INTO payroll_history (
      tenant_id,
      payroll_month,
      year,
      quarter,
      employee_id,
      department,
      project_contract,
      basic_salary,
      housing_allowance,
      transport_allowance,
      other_allowances,
      overtime_amount,
      bonuses,
      arrears,
      net_only_adjustment,
      gross_pay,
      employee_ssnit,
      employer_ssnit,
      tier2,
      paye_tax,
      loan_repayment,
      salary_advance,
      welfare_deduction,
      other_deductions,
      absence_deduction,
      total_deductions,
      net_pay,
      locked,
      locked_at
    ) VALUES (
      p_tenant_id,
      p_payroll_month,
      v_hist_year,
      'Q' || ceil(v_hist_month / 3.0)::integer || ' ' || v_hist_year,
      v_elem ->> 'employee_id',
      v_elem ->> 'department',
      v_elem ->> 'project_contract',
      nullif(v_elem ->> 'basic_salary', '')::numeric,
      nullif(v_elem ->> 'housing_allowance', '')::numeric,
      nullif(v_elem ->> 'transport_allowance', '')::numeric,
      nullif(v_elem ->> 'other_allowances', '')::numeric,
      nullif(v_elem ->> 'overtime_amount', '')::numeric,
      nullif(v_elem ->> 'bonuses', '')::numeric,
      nullif(v_elem ->> 'arrears', '')::numeric,
      nullif(v_elem ->> 'net_only_adjustment', '')::numeric,
      nullif(v_elem ->> 'gross_pay', '')::numeric,
      nullif(v_elem ->> 'employee_ssnit', '')::numeric,
      nullif(v_elem ->> 'employer_ssnit', '')::numeric,
      nullif(v_elem ->> 'tier2', '')::numeric,
      nullif(v_elem ->> 'paye_tax', '')::numeric,
      nullif(v_elem ->> 'loan_repayment', '')::numeric,
      nullif(v_elem ->> 'salary_advance', '')::numeric,
      nullif(v_elem ->> 'welfare_deduction', '')::numeric,
      nullif(v_elem ->> 'other_deductions', '')::numeric,
      nullif(v_elem ->> 'absence_deduction', '')::numeric,
      nullif(v_elem ->> 'total_deductions', '')::numeric,
      nullif(v_elem ->> 'net_pay', '')::numeric,
      v_is_full_lock,
      CASE WHEN v_is_full_lock THEN v_locked_at ELSE NULL END
    );
  END LOOP;

  DELETE FROM payroll_processing
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);

  PERFORM public._promote_payroll_allowance_lines_to_history(
    p_tenant_id,
    p_payroll_month,
    p_business_unit_id
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
    jsonb_array_length(v_scoped_rows),
    v_total_net_pay,
    p_lock_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  ON CONFLICT (tenant_id, business_unit_id, month) DO UPDATE
  SET
    employees_recorded = EXCLUDED.employees_recorded,
    total_net_pay = EXCLUDED.total_net_pay,
    lock_status = EXCLUDED.lock_status,
    notes = EXCLUDED.notes;

  v_finance_rows := public._payroll_rows_to_finance_jsonb(v_scoped_rows);

  v_finance_result := public._post_payroll_lock_finance(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    v_year,
    v_month,
    v_finance_rows,
    v_is_full_lock,
    false
  );

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
    'promotedFromPartial', false,
    'previousEmployeesRecorded', NULL
  );
END;
$$;

-- Shared helpers + reopen/release RPCs: see scripts/285_atomic_payroll_release.sql
-- (_payroll_restore_processing_from_history, _payroll_open_period_core,
--  reopen_payroll_period with daily_rate/days_to_pay, release_payroll_period).

CREATE OR REPLACE FUNCTION public._payroll_restore_processing_from_history(
  p_tenant_id uuid,
  p_payroll_month date,
  p_employee_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_hist record;
  v_total_net_pay numeric := 0;
  v_restored integer := 0;
BEGIN
  DELETE FROM payroll_processing
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);

  FOR v_hist IN
    SELECT *
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  LOOP
    INSERT INTO payroll_processing (
      tenant_id,
      payroll_month,
      status,
      employee_id,
      basic_salary,
      housing_allowance,
      transport_allowance,
      other_allowances,
      department,
      project_contract,
      daily_rate,
      days_to_pay,
      absence_deduction,
      overtime_amount,
      loan_repayment,
      bonuses,
      arrears,
      net_only_adjustment,
      salary_advance,
      welfare_deduction,
      other_deductions,
      gross_pay,
      employee_ssnit,
      employer_ssnit,
      tier2,
      paye_tax,
      total_deductions,
      net_pay
    ) VALUES (
      p_tenant_id,
      v_hist.payroll_month,
      'Open',
      v_hist.employee_id,
      v_hist.basic_salary,
      v_hist.housing_allowance,
      v_hist.transport_allowance,
      v_hist.other_allowances,
      v_hist.department,
      v_hist.project_contract,
      v_hist.daily_rate,
      v_hist.days_to_pay,
      v_hist.absence_deduction,
      v_hist.overtime_amount,
      v_hist.loan_repayment,
      v_hist.bonuses,
      v_hist.arrears,
      v_hist.net_only_adjustment,
      v_hist.salary_advance,
      v_hist.welfare_deduction,
      v_hist.other_deductions,
      v_hist.gross_pay,
      v_hist.employee_ssnit,
      v_hist.employer_ssnit,
      v_hist.tier2,
      v_hist.paye_tax,
      v_hist.total_deductions,
      v_hist.net_pay
    );

    v_total_net_pay := public._payroll_round_currency(
      v_total_net_pay + coalesce(v_hist.net_pay, 0)
    );
    v_restored := v_restored + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'restoredRows', v_restored,
    'totalNetPay', v_total_net_pay
  );
END;
$$;

REVOKE ALL ON FUNCTION public._payroll_restore_processing_from_history(uuid, date, text[]) FROM PUBLIC;

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

REVOKE ALL ON FUNCTION public._payroll_open_period_core(
  uuid, uuid, text[], date, integer, integer
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.reopen_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_close record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  SELECT *
  INTO v_close
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF v_close.lock_status IS DISTINCT FROM 'Partially Locked' THEN
    RAISE EXCEPTION 'Only partially locked periods can be reopened';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
      AND locked IS TRUE
  ) THEN
    RAISE EXCEPTION
      'This period has permanently locked payroll records and cannot be reopened';
  END IF;

  RETURN public._payroll_open_period_core(
    p_tenant_id,
    p_business_unit_id,
    p_employee_ids,
    p_payroll_month,
    p_period_year,
    p_period_month
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_close record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  SELECT *
  INTO v_close
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF v_close.lock_status IS DISTINCT FROM 'Locked' THEN
    RAISE EXCEPTION
      'Only permanently locked periods can be released. Use Reopen Period for partially locked months.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  RETURN public._payroll_open_period_core(
    p_tenant_id,
    p_business_unit_id,
    p_employee_ids,
    p_payroll_month,
    p_period_year,
    p_period_month
  );
END;
$$;

COMMENT ON FUNCTION public.release_payroll_period(
  uuid, uuid, text[], date, integer, integer
) IS
  'Atomically release a Fully Locked payroll period to Open: finance teardown, processing restore, history delete, month_end_close update.';

REVOKE ALL ON FUNCTION public.lock_payroll_period(uuid, uuid, text[], date, integer, integer, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reopen_payroll_period(uuid, uuid, text[], date, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_payroll_period(uuid, uuid, text[], date, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lock_payroll_period(uuid, uuid, text[], date, integer, integer, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reopen_payroll_period(uuid, uuid, text[], date, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_payroll_period(uuid, uuid, text[], date, integer, integer) TO service_role;

COMMIT;
