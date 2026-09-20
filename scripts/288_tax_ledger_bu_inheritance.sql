-- 288_tax_ledger_bu_inheritance.sql
-- Ensure new tax_ledger_entries inherit business_unit_id from their source row.
-- Idempotent re-apply of income/purchase replace RPCs + payroll deduction-savings stamp.

BEGIN;

-- ---------------------------------------------------------------------------
-- Income: replace_income_register_tax_ledger_entries (from 265)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_income_register_tax_ledger_entries(
  p_source_id text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_system_adjustment boolean;
  v_business_unit_id uuid;
BEGIN
  IF p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'p_source_id is required';
  END IF;

  SELECT i.is_system_adjustment, i.business_unit_id
  INTO v_is_system_adjustment, v_business_unit_id
  FROM public.income_register i
  WHERE i.id::text = p_source_id;

  IF FOUND AND v_is_system_adjustment IS TRUE THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = p_source_id;
    RETURN;
  END IF;

  DELETE FROM public.tax_ledger_entries
  WHERE source_type = 'income_register'
    AND source_id = p_source_id;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.tax_ledger_entries (
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
  )
  SELECT
    COALESCE(
      NULLIF(r->>'tenant_id', '')::uuid,
      public.current_user_tenant_id()
    ),
    (r->>'entry_date')::date,
    (r->>'period_month')::date,
    r->>'direction',
    r->>'tax_component',
    NULLIF(r->>'rate_pct', '')::numeric,
    COALESCE((r->>'taxable_base')::numeric, 0),
    COALESCE((r->>'tax_amount')::numeric, 0),
    COALESCE(NULLIF(r->>'status', ''), 'open'),
    'income_register',
    p_source_id,
    NULLIF(r->>'counterparty_name', ''),
    NULLIF(r->>'notes', ''),
    v_business_unit_id
  FROM jsonb_array_elements(p_rows) AS t(r);
END;
$function$;

COMMENT ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb) IS
  'Replace tax_ledger_entries for one income_register source_id (DELETE+INSERT). '
  'business_unit_id is inherited from income_register (288); payload BU is ignored.';

GRANT EXECUTE ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Purchase: replace_purchase_tax_ledger_entries (from 282)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_purchase_tax_ledger_entries(
  p_source_type text,
  p_source_id text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_type text := lower(btrim(coalesce(p_source_type, '')));
  v_source_id text := btrim(coalesce(p_source_id, ''));
  v_business_unit_id uuid;
  v_source_tenant_id uuid;
BEGIN
  IF v_source_type NOT IN ('expense_register', 'accounts_payable', 'fixed_asset') THEN
    RAISE EXCEPTION 'Invalid purchase tax source_type: %', p_source_type;
  END IF;

  IF v_source_id = '' THEN
    RAISE EXCEPTION 'p_source_id is required';
  END IF;

  SELECT ctx.business_unit_id, ctx.tenant_id
  INTO v_business_unit_id, v_source_tenant_id
  FROM public._pur_lookup_purchase_source_context(v_source_type, v_source_id) ctx;

  DELETE FROM public.tax_ledger_entries t
  WHERE t.source_type = v_source_type
    AND t.source_id = v_source_id;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.tax_ledger_entries (
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
  )
  SELECT
    coalesce(
      nullif(r->>'tenant_id', '')::uuid,
      v_source_tenant_id,
      public.current_user_tenant_id()
    ),
    (r->>'entry_date')::date,
    (r->>'period_month')::date,
    r->>'direction',
    r->>'tax_component',
    nullif(r->>'rate_pct', '')::numeric,
    coalesce((r->>'taxable_base')::numeric, 0),
    coalesce((r->>'tax_amount')::numeric, 0),
    coalesce(nullif(r->>'status', ''), 'open'),
    v_source_type,
    v_source_id,
    nullif(r->>'counterparty_name', ''),
    nullif(r->>'notes', ''),
    v_business_unit_id
  FROM jsonb_array_elements(p_rows) AS t(r);
END;
$$;

COMMENT ON FUNCTION public.replace_purchase_tax_ledger_entries(text, text, jsonb) IS
  'Atomically replace tax_ledger_entries for one purchase source (DELETE+INSERT). '
  'business_unit_id inherited from expense_register / accounts_payable / fixed_assets.';

REVOKE ALL ON FUNCTION public.replace_purchase_tax_ledger_entries(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_purchase_tax_ledger_entries(text, text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Payroll lock: stamp deduction-savings income with lock BU
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._payroll_upsert_deduction_savings_income(uuid, date, text, text, numeric);

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
  ) VALUES (
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

NOTIFY pgrst, 'reload schema';

COMMIT;
