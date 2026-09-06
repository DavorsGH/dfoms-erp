-- Atomic tax remit / undo-remit (single-transaction RPCs).
-- Mirrors app/dashboard/finance/tax-ledger-remit.ts (formulas unchanged; atomicity only).

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared helpers (private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._tr_round_currency(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(coalesce(p_value, 0)::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._tr_normalize_payment_status(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(coalesce(btrim(p_value), ''), '\s+', ' ', 'g'),
      E'\\u2013|\\u2014',
      '-',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._tr_is_paid_status(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._tr_normalize_payment_status(p_value) = 'paid';
$$;

CREATE OR REPLACE FUNCTION public._tr_is_settled_no_cash_status(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    public._tr_normalize_payment_status(p_value) LIKE '%settled%'
    AND (
      public._tr_normalize_payment_status(p_value) LIKE '%no cash%'
      OR public._tr_normalize_payment_status(p_value) LIKE '%non-cash%'
    );
$$;

CREATE OR REPLACE FUNCTION public._tr_is_accrued_status(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(public._tr_normalize_payment_status(p_value), '') = '' THEN false
    WHEN public._tr_is_paid_status(p_value) THEN false
    WHEN public._tr_normalize_payment_status(p_value) = 'partial' THEN false
    WHEN public._tr_is_settled_no_cash_status(p_value) THEN false
    WHEN public._tr_normalize_payment_status(p_value) LIKE '%accrued%' THEN true
    WHEN public._tr_normalize_payment_status(p_value) LIKE '%not yet paid%' THEN true
    WHEN public._tr_normalize_payment_status(p_value) = 'accrued - not yet paid' THEN true
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_period_key(p_period_month date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT to_char(p_period_month, 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION public._tr_period_end_date(p_period_month date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date;
$$;

CREATE OR REPLACE FUNCTION public._tr_period_label(p_period_month date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(to_char(p_period_month, 'FMMonth YYYY'));
$$;

CREATE OR REPLACE FUNCTION public._tr_remit_kind_label(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_kind, ''))
    WHEN 'ssnit' THEN 'SSNIT'
    WHEN 'paye' THEN 'PAYE'
    WHEN 'vat' THEN 'VAT'
    WHEN 'wht' THEN 'WHT'
    ELSE upper(coalesce(p_kind, ''))
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_remit_receipt_prefix(p_kind text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_kind, ''))
    WHEN 'ssnit' THEN 'TAX-REMIT-SSNIT'
    WHEN 'paye' THEN 'TAX-REMIT-PAYE'
    WHEN 'vat' THEN 'TAX-REMIT-VAT'
    WHEN 'wht' THEN 'TAX-REMIT-WHT'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_build_remit_receipt_no(p_kind text, p_period_month date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._tr_remit_receipt_prefix(p_kind) || '-' || public._tr_period_key(p_period_month);
$$;

CREATE OR REPLACE FUNCTION public._tr_build_payroll_essnit_receipt_no(p_period_month date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'PAYROLL-ESSNIT-' || public._tr_period_key(p_period_month);
$$;

CREATE OR REPLACE FUNCTION public._tr_components_for_remit_kind(p_kind text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_kind, ''))
    WHEN 'ssnit' THEN ARRAY['ssnit_employee', 'ssnit_employer_tier1', 'ssnit_tier2']::text[]
    WHEN 'paye' THEN ARRAY['paye']::text[]
    WHEN 'vat' THEN ARRAY['vat_bundle', 'vfrs']::text[]
    WHEN 'wht' THEN ARRAY['wht']::text[]
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_is_employer_ssnit_component(p_component text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_component, '') IN ('ssnit_employer_tier1', 'ssnit_tier2');
$$;

CREATE OR REPLACE FUNCTION public._tr_append_remitted_note(
  p_existing_notes text,
  p_remitted_on date
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(btrim(p_existing_notes), '') = '' THEN
      '[Remitted ' || to_char(p_remitted_on, 'YYYY-MM-DD') || ']'
    WHEN p_existing_notes LIKE '%[Remitted %' THEN
      p_existing_notes
    ELSE
      btrim(p_existing_notes) || ' [Remitted ' || to_char(p_remitted_on, 'YYYY-MM-DD') || ']'
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_strip_remitted_note(p_existing_notes text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    btrim(regexp_replace(coalesce(p_existing_notes, ''), '\s*\[Remitted \d{4}-\d{2}-\d{2}\]', '', 'g')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public._tr_bu_scope_matches(
  p_row_business_unit_id uuid,
  p_business_unit_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (
    (p_business_unit_id IS NULL AND p_row_business_unit_id IS NULL)
    OR (p_business_unit_id IS NOT NULL AND p_row_business_unit_id = p_business_unit_id)
  );
$$;

CREATE OR REPLACE FUNCTION public._tr_days_in_month(p_year integer, p_month integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extract(day FROM (date_trunc('month', make_date(p_year, p_month, 1)) + interval '1 month - 1 day'))::integer;
$$;

CREATE OR REPLACE FUNCTION public._tr_build_return_due_date(
  p_year integer,
  p_month integer,
  p_due_day integer
)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT make_date(
    p_year,
    p_month,
    least(greatest(p_due_day, 1), public._tr_days_in_month(p_year, p_month))
  );
$$;

CREATE OR REPLACE FUNCTION public._tr_add_calendar_months(
  p_year integer,
  p_month integer,
  p_step integer
)
RETURNS TABLE(out_year integer, out_month integer)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH absolute AS (
    SELECT (p_year * 12 + (p_month - 1) + p_step) AS m
  )
  SELECT (m / 12)::integer, ((m % 12) + 1)::integer FROM absolute;
$$;

CREATE OR REPLACE FUNCTION public._tr_advance_due_date_after_remittance(
  p_current_next_due date,
  p_due_day integer,
  p_today date,
  p_month_step integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_anchor date;
  v_year integer;
  v_month integer;
  v_candidate date;
  v_step integer := greatest(coalesce(p_month_step, 1), 1);
BEGIN
  IF p_due_day IS NULL OR p_due_day < 1 OR p_due_day > 31 THEN
    RETURN NULL;
  END IF;

  v_anchor := coalesce(p_current_next_due, p_today);

  SELECT out_year, out_month
  INTO v_year, v_month
  FROM public._tr_add_calendar_months(
    extract(year FROM v_anchor)::integer,
    extract(month FROM v_anchor)::integer,
    v_step
  );

  v_candidate := public._tr_build_return_due_date(v_year, v_month, p_due_day);

  WHILE v_candidate <= p_today LOOP
    SELECT out_year, out_month
    INTO v_year, v_month
    FROM public._tr_add_calendar_months(v_year, v_month, v_step);
    v_candidate := public._tr_build_return_due_date(v_year, v_month, p_due_day);
  END LOOP;

  RETURN v_candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public._tr_statutory_kind_for_component(p_component text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE coalesce(p_component, '')
    WHEN 'vat_bundle' THEN 'vat'
    WHEN 'vfrs' THEN 'vat'
    WHEN 'wht' THEN 'wht'
    WHEN 'paye' THEN 'paye'
    WHEN 'ssnit_employee' THEN 'ssnit'
    WHEN 'ssnit_employer_tier1' THEN 'ssnit'
    WHEN 'ssnit_tier2' THEN 'tier2'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public._tr_has_open_entries_for_statutory_kind(
  p_tenant_id uuid,
  p_kind text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tax_ledger_entries t
    WHERE t.tenant_id = p_tenant_id
      AND t.status = 'open'
      AND (
        (p_kind = 'vat' AND t.tax_component IN ('vat_bundle', 'vfrs'))
        OR (p_kind = 'wht' AND t.tax_component = 'wht')
        OR (p_kind = 'paye' AND t.tax_component = 'paye')
        OR (p_kind = 'ssnit' AND t.tax_component IN ('ssnit_employee', 'ssnit_employer_tier1'))
        OR (p_kind = 'tier2' AND t.tax_component = 'ssnit_tier2')
      )
  );
$$;

CREATE OR REPLACE FUNCTION public._tr_compute_remit_cash_amount(
  p_kind text,
  p_candidate_ids uuid[]
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_kind text := lower(coalesce(p_kind, ''));
  v_total numeric;
  v_output numeric;
  v_input numeric;
BEGIN
  IF coalesce(array_length(p_candidate_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  IF v_kind = 'vat' THEN
    SELECT
      coalesce(sum(CASE WHEN direction = 'output' THEN tax_amount ELSE 0 END), 0),
      coalesce(sum(CASE WHEN direction = 'input' THEN tax_amount ELSE 0 END), 0)
    INTO v_output, v_input
    FROM public.tax_ledger_entries
    WHERE id = ANY (p_candidate_ids);

    RETURN public._tr_round_currency(greatest(0, v_output - v_input));
  END IF;

  SELECT coalesce(sum(tax_amount), 0)
  INTO v_total
  FROM public.tax_ledger_entries
  WHERE id = ANY (p_candidate_ids);

  RETURN public._tr_round_currency(v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public._tr_align_essnit_for_ssnit_remit(
  p_tenant_id uuid,
  p_period_month date
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_no text;
  v_essnit record;
BEGIN
  v_receipt_no := public._tr_build_payroll_essnit_receipt_no(p_period_month);

  SELECT id, payment_status, amount
  INTO v_essnit
  FROM public.expense_register
  WHERE tenant_id = p_tenant_id
    AND receipt_no = v_receipt_no
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'none';
  END IF;

  IF public._tr_is_paid_status(v_essnit.payment_status) THEN
    RETURN 'already_paid';
  END IF;

  IF public._tr_is_settled_no_cash_status(v_essnit.payment_status) THEN
    RETURN 'already_settled';
  END IF;

  UPDATE public.expense_register
  SET payment_status = 'Settled (No Cash Impact)'
  WHERE id = v_essnit.id
    AND tenant_id = p_tenant_id;

  RETURN 'settled';
END;
$$;

CREATE OR REPLACE FUNCTION public._tr_restore_essnit_after_ssnit_undo(
  p_tenant_id uuid,
  p_period_month date
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_no text;
  v_essnit record;
BEGIN
  v_receipt_no := public._tr_build_payroll_essnit_receipt_no(p_period_month);

  SELECT id, payment_status
  INTO v_essnit
  FROM public.expense_register
  WHERE tenant_id = p_tenant_id
    AND receipt_no = v_receipt_no
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'none';
  END IF;

  IF public._tr_is_paid_status(v_essnit.payment_status) THEN
    RETURN 'left_paid';
  END IF;

  IF NOT public._tr_is_settled_no_cash_status(v_essnit.payment_status) THEN
    RETURN 'left_other';
  END IF;

  UPDATE public.expense_register
  SET payment_status = 'Accrued - Not Yet Paid'
  WHERE id = v_essnit.id
    AND tenant_id = p_tenant_id;

  RETURN 'accrued';
END;
$$;

CREATE OR REPLACE FUNCTION public._tr_apply_remittance_due_date_patch(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_remitted_components text[]
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_settings record;
  v_kind text;
  v_kinds text[] := ARRAY[]::text[];
  v_component text;
  v_due_day integer;
  v_month_step integer;
  v_current date;
  v_advanced date;
  v_updated boolean := false;
BEGIN
  SELECT *
  INTO v_settings
  FROM public.tax_settings ts
  WHERE ts.tenant_id = p_tenant_id
    AND (
      (p_business_unit_id IS NULL AND ts.business_unit_id IS NULL)
      OR (p_business_unit_id IS NOT NULL AND ts.business_unit_id = p_business_unit_id)
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  FOREACH v_component IN ARRAY coalesce(p_remitted_components, ARRAY[]::text[]) LOOP
    v_kind := public._tr_statutory_kind_for_component(v_component);
    IF v_kind IS NOT NULL AND NOT (v_kind = ANY (v_kinds)) THEN
      v_kinds := array_append(v_kinds, v_kind);
    END IF;
  END LOOP;

  FOREACH v_kind IN ARRAY v_kinds LOOP
    IF public._tr_has_open_entries_for_statutory_kind(p_tenant_id, v_kind) THEN
      CONTINUE;
    END IF;

    v_due_day := CASE v_kind
      WHEN 'vat' THEN v_settings.vat_return_due_day
      WHEN 'wht' THEN v_settings.wht_return_due_day
      WHEN 'paye' THEN v_settings.paye_return_due_day
      WHEN 'ssnit' THEN v_settings.ssnit_return_due_day
      WHEN 'tier2' THEN v_settings.tier2_return_due_day
      ELSE NULL
    END;

    v_month_step := CASE
      WHEN v_kind = 'vat' AND v_settings.vat_return_period = 'quarterly' THEN 3
      ELSE 1
    END;

    v_current := CASE v_kind
      WHEN 'vat' THEN v_settings.next_vat_due_date
      WHEN 'wht' THEN v_settings.next_wht_due_date
      WHEN 'paye' THEN v_settings.next_paye_due_date
      WHEN 'ssnit' THEN v_settings.next_ssnit_due_date
      WHEN 'tier2' THEN v_settings.next_tier2_due_date
      ELSE NULL
    END;

    v_advanced := public._tr_advance_due_date_after_remittance(
      v_current,
      v_due_day,
      current_date,
      v_month_step
    );

    IF v_advanced IS NULL THEN
      CONTINUE;
    END IF;

    IF v_current IS NOT NULL AND v_advanced = v_current THEN
      CONTINUE;
    END IF;

    UPDATE public.tax_settings ts
    SET
      next_vat_due_date = CASE WHEN v_kind = 'vat' THEN v_advanced ELSE ts.next_vat_due_date END,
      next_wht_due_date = CASE WHEN v_kind = 'wht' THEN v_advanced ELSE ts.next_wht_due_date END,
      next_paye_due_date = CASE WHEN v_kind = 'paye' THEN v_advanced ELSE ts.next_paye_due_date END,
      next_ssnit_due_date = CASE WHEN v_kind = 'ssnit' THEN v_advanced ELSE ts.next_ssnit_due_date END,
      next_tier2_due_date = CASE WHEN v_kind = 'tier2' THEN v_advanced ELSE ts.next_tier2_due_date END
    WHERE ts.tenant_id = p_tenant_id
      AND (
        (p_business_unit_id IS NULL AND ts.business_unit_id IS NULL)
        OR (p_business_unit_id IS NOT NULL AND ts.business_unit_id = p_business_unit_id)
      );

    v_updated := true;
  END LOOP;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public._tr_remit_result(
  p_error text,
  p_kind text,
  p_period_month date,
  p_legs_cleared integer,
  p_cash_amount numeric,
  p_expense_receipt_no text,
  p_expense_inserted boolean,
  p_essnit_aligned text,
  p_due_date_advanced boolean,
  p_message text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'error', p_error,
    'kind', p_kind,
    'periodMonth', to_char(p_period_month, 'YYYY-MM-DD'),
    'legsCleared', coalesce(p_legs_cleared, 0),
    'cashAmount', coalesce(p_cash_amount, 0),
    'expenseReceiptNo', p_expense_receipt_no,
    'expenseInserted', coalesce(p_expense_inserted, false),
    'essnitAligned', p_essnit_aligned,
    'dueDateAdvanced', coalesce(p_due_date_advanced, false),
    'message', p_message
  );
$$;

-- ---------------------------------------------------------------------------
-- Public RPC: remit_tax_for_period
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remit_tax_for_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_period_month date,
  p_kind text,
  p_view_all_business_units boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_period_month date := p_period_month;
  v_label text;
  v_period_label text;
  v_components text[];
  v_candidate_ids uuid[];
  v_cash_amount numeric := 0;
  v_employer_cash_skipped boolean := false;
  v_receipt_no text;
  v_existing_expense record;
  v_expense_inserted boolean := false;
  v_essnit_aligned text := NULL;
  v_essnit record;
  v_cash_eligible_ids uuid[];
  v_employer_open_count integer := 0;
  v_remittable_on date := current_date;
  v_now timestamptz := now();
  v_legs_cleared integer := 0;
  v_due_date_advanced boolean := false;
  v_remitted_components text[];
  v_message text;
  v_active_bu_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF v_period_month IS NULL THEN
    RAISE EXCEPTION 'Invalid period month.';
  END IF;

  IF v_kind NOT IN ('ssnit', 'paye', 'vat', 'wht') THEN
    RAISE EXCEPTION 'Invalid kind.';
  END IF;

  SELECT count(*)::integer
  INTO v_active_bu_count
  FROM public.business_units bu
  WHERE bu.tenant_id = p_tenant_id
    AND bu.is_active IS TRUE;

  IF coalesce(p_view_all_business_units, false) AND v_active_bu_count >= 1 THEN
    RAISE EXCEPTION 'Select your workspace default or a specific business before remitting tax. Remitting while All Businesses is selected (dfoms-bu-view-all-no-remit) is not allowed when this workspace has business units.';
  END IF;

  v_label := public._tr_remit_kind_label(v_kind);
  v_period_label := public._tr_period_label(v_period_month);
  v_components := public._tr_components_for_remit_kind(v_kind);

  SELECT coalesce(array_agg(t.id ORDER BY t.id), ARRAY[]::uuid[])
  INTO v_candidate_ids
  FROM public.tax_ledger_entries t
  WHERE t.tenant_id = p_tenant_id
    AND t.period_month = v_period_month
    AND t.status = 'open'
    AND t.tax_component = ANY (v_components)
    AND public._tr_bu_scope_matches(t.business_unit_id, p_business_unit_id)
    AND (v_kind <> 'wht' OR t.direction = 'wht_payable');

  IF coalesce(array_length(v_candidate_ids, 1), 0) = 0 THEN
    RETURN public._tr_remit_result(
      NULL,
      v_kind,
      v_period_month,
      0,
      0,
      NULL,
      false,
      NULL,
      false,
      format('No open %s liabilities for %s to remit.', v_label, v_period_label)
    );
  END IF;

  v_cash_amount := public._tr_compute_remit_cash_amount(v_kind, v_candidate_ids);

  IF v_kind = 'ssnit' THEN
    SELECT id, payment_status, amount
    INTO v_essnit
    FROM public.expense_register
    WHERE tenant_id = p_tenant_id
      AND receipt_no = public._tr_build_payroll_essnit_receipt_no(v_period_month)
    LIMIT 1;

    IF FOUND AND public._tr_is_paid_status(v_essnit.payment_status) THEN
      SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
      INTO v_cash_eligible_ids
      FROM public.tax_ledger_entries
      WHERE id = ANY (v_candidate_ids)
        AND NOT public._tr_is_employer_ssnit_component(tax_component);

      SELECT count(*)::integer
      INTO v_employer_open_count
      FROM public.tax_ledger_entries
      WHERE id = ANY (v_candidate_ids)
        AND public._tr_is_employer_ssnit_component(tax_component);

      IF v_employer_open_count > 0 THEN
        v_employer_cash_skipped := true;
      END IF;

      v_cash_amount := public._tr_compute_remit_cash_amount(v_kind, v_cash_eligible_ids);
    ELSIF FOUND
      AND public._tr_is_accrued_status(v_essnit.payment_status)
      AND NOT EXISTS (
        SELECT 1
        FROM public.tax_ledger_entries t
        WHERE t.id = ANY (v_candidate_ids)
          AND public._tr_is_employer_ssnit_component(t.tax_component)
      ) THEN
      v_cash_amount := public._tr_round_currency(
        v_cash_amount + coalesce(v_essnit.amount, 0)
      );
    END IF;
  END IF;

  IF v_kind = 'vat' AND v_cash_amount <= 0 THEN
    RETURN public._tr_remit_result(
      NULL,
      v_kind,
      v_period_month,
      0,
      0,
      NULL,
      false,
      NULL,
      false,
      format('No net VAT payable for %s (output ≤ input). Nothing remitted.', v_period_label)
    );
  END IF;

  IF v_cash_amount <= 0 THEN
    IF v_kind = 'ssnit' AND v_employer_cash_skipped AND coalesce(array_length(v_candidate_ids, 1), 0) > 0 THEN
      v_essnit_aligned := public._tr_align_essnit_for_ssnit_remit(p_tenant_id, v_period_month);

      UPDATE public.tax_ledger_entries t
      SET
        status = 'paid',
        remitted_at = v_remittable_on,
        notes = public._tr_append_remitted_note(t.notes, v_remittable_on),
        updated_at = v_now
      WHERE t.id = ANY (v_candidate_ids)
        AND t.tenant_id = p_tenant_id
        AND t.status = 'open';

      GET DIAGNOSTICS v_legs_cleared = ROW_COUNT;

      RETURN public._tr_remit_result(
        NULL,
        v_kind,
        v_period_month,
        v_legs_cleared,
        0,
        NULL,
        false,
        v_essnit_aligned,
        false,
        format(
          'Cleared %s open employer SSNIT leg(s) for %s with no additional cash (Employer SSNIT already Paid via Expense Register).',
          v_legs_cleared,
          v_period_label
        )
      );
    END IF;

    RETURN public._tr_remit_result(
      NULL,
      v_kind,
      v_period_month,
      0,
      0,
      NULL,
      false,
      NULL,
      false,
      format('Open %s legs for %s sum to zero. Nothing remitted.', v_label, v_period_label)
    );
  END IF;

  v_receipt_no := public._tr_build_remit_receipt_no(v_kind, v_period_month);

  SELECT id, payment_status, amount
  INTO v_existing_expense
  FROM public.expense_register
  WHERE tenant_id = p_tenant_id
    AND receipt_no = v_receipt_no
  LIMIT 1;

  IF FOUND AND public._tr_is_paid_status(v_existing_expense.payment_status) THEN
    RAISE EXCEPTION 'Remittance already posted for % % (%).', v_label, v_period_label, v_receipt_no;
  END IF;

  IF FOUND THEN
    UPDATE public.expense_register
    SET
      date = public._tr_period_end_date(v_period_month),
      expense_category = 'Statutory Remittance',
      sub_category = 'Tax Remittance',
      description = format('%s remittance for %s', v_label, v_period_label),
      vendor = CASE WHEN v_kind = 'ssnit' THEN 'SSNIT' ELSE 'GRA' END,
      price = v_cash_amount,
      quantity = 1,
      amount = v_cash_amount,
      payment_method = 'Bank Transfer',
      payment_status = 'Paid',
      approved_by = 'System',
      notes = format('Tax Ledger remit-for-period (%s)', v_kind)
    WHERE id = v_existing_expense.id
      AND tenant_id = p_tenant_id;
  ELSE
    INSERT INTO public.expense_register (
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
    )
    VALUES (
      p_tenant_id,
      public._tr_period_end_date(v_period_month),
      'Statutory Remittance',
      'Tax Remittance',
      format('%s remittance for %s', v_label, v_period_label),
      CASE WHEN v_kind = 'ssnit' THEN 'SSNIT' ELSE 'GRA' END,
      v_cash_amount,
      1,
      v_cash_amount,
      'Bank Transfer',
      'System',
      v_receipt_no,
      'Paid',
      format('Tax Ledger remit-for-period (%s)', v_kind),
      p_business_unit_id
    );
    v_expense_inserted := true;
  END IF;

  IF v_kind = 'ssnit' THEN
    v_essnit_aligned := public._tr_align_essnit_for_ssnit_remit(p_tenant_id, v_period_month);
  END IF;

  UPDATE public.tax_ledger_entries t
  SET
    status = 'paid',
    remitted_at = v_remittable_on,
    notes = public._tr_append_remitted_note(t.notes, v_remittable_on),
    updated_at = v_now
  WHERE t.id = ANY (v_candidate_ids)
    AND t.tenant_id = p_tenant_id
    AND t.status = 'open';

  GET DIAGNOSTICS v_legs_cleared = ROW_COUNT;

  IF v_legs_cleared <> coalesce(array_length(v_candidate_ids, 1), 0) THEN
    RAISE EXCEPTION 'Tax Ledger clear failed: expected % leg(s), updated %.', array_length(v_candidate_ids, 1), v_legs_cleared;
  END IF;

  SELECT coalesce(array_agg(DISTINCT tax_component), ARRAY[]::text[])
  INTO v_remitted_components
  FROM public.tax_ledger_entries
  WHERE id = ANY (v_candidate_ids);

  v_due_date_advanced := public._tr_apply_remittance_due_date_patch(
    p_tenant_id,
    p_business_unit_id,
    v_remitted_components
  );

  v_message := format(
    'Remitted %s for %s: cleared %s leg(s), Cash Position outflow %s (%s).',
    v_label,
    v_period_label,
    v_legs_cleared,
    to_char(v_cash_amount, 'FM999999990.00'),
    v_receipt_no
  );

  IF v_essnit_aligned = 'settled' THEN
    v_message := v_message || ' Accrued Employer SSNIT expense marked Settled (No Cash Impact).';
  ELSIF v_essnit_aligned = 'already_paid' THEN
    IF v_employer_cash_skipped THEN
      v_message := v_message || ' Employer SSNIT already Paid — remittance cash is employee (and any non-employer) legs only; open employer legs cleared without extra cash.';
    ELSE
      v_message := v_message || ' Employer SSNIT expense already Paid — remittance cash is for remaining open legs only.';
    END IF;
  END IF;

  IF v_due_date_advanced THEN
    v_message := v_message || ' Next due date advanced.';
  END IF;

  RETURN public._tr_remit_result(
    NULL,
    v_kind,
    v_period_month,
    v_legs_cleared,
    v_cash_amount,
    v_receipt_no,
    v_expense_inserted,
    v_essnit_aligned,
    v_due_date_advanced,
    v_message
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC: undo_remit_tax_for_period
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.undo_remit_tax_for_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_period_month date,
  p_kind text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_period_month date := p_period_month;
  v_label text;
  v_period_label text;
  v_receipt_no text;
  v_paid_expense record;
  v_cash_amount numeric := 0;
  v_essnit_restored text := NULL;
  v_leave_employer_legs_remitted boolean := false;
  v_essnit record;
  v_components text[];
  v_legs_reopened integer := 0;
  v_now timestamptz := now();
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF v_period_month IS NULL THEN
    RAISE EXCEPTION 'Invalid period month.';
  END IF;

  IF v_kind NOT IN ('ssnit', 'paye', 'vat', 'wht') THEN
    RAISE EXCEPTION 'Invalid kind.';
  END IF;

  v_label := public._tr_remit_kind_label(v_kind);
  v_period_label := public._tr_period_label(v_period_month);
  v_receipt_no := public._tr_build_remit_receipt_no(v_kind, v_period_month);

  SELECT id, receipt_no, amount, payment_status
  INTO v_paid_expense
  FROM public.expense_register
  WHERE tenant_id = p_tenant_id
    AND receipt_no = v_receipt_no
  LIMIT 1;

  IF NOT FOUND OR NOT public._tr_is_paid_status(v_paid_expense.payment_status) THEN
    RETURN jsonb_build_object(
      'error', NULL,
      'kind', v_kind,
      'periodMonth', to_char(v_period_month, 'YYYY-MM-DD'),
      'legsReopened', 0,
      'cashAmountReversed', 0,
      'expenseReceiptNo', NULL,
      'expenseDeleted', false,
      'essnitRestored', NULL,
      'message', format('No Paid %s remittance (%s) for %s to undo.', v_label, v_receipt_no, v_period_label)
    );
  END IF;

  v_cash_amount := public._tr_round_currency(v_paid_expense.amount);

  IF v_kind = 'ssnit' THEN
    SELECT id, payment_status
    INTO v_essnit
    FROM public.expense_register
    WHERE tenant_id = p_tenant_id
      AND receipt_no = public._tr_build_payroll_essnit_receipt_no(v_period_month)
    LIMIT 1;

    IF FOUND AND public._tr_is_paid_status(v_essnit.payment_status) THEN
      v_leave_employer_legs_remitted := true;
    END IF;
  END IF;

  DELETE FROM public.expense_register
  WHERE id = v_paid_expense.id
    AND tenant_id = p_tenant_id;

  IF v_kind = 'ssnit' THEN
    v_essnit_restored := public._tr_restore_essnit_after_ssnit_undo(p_tenant_id, v_period_month);
  END IF;

  v_components := public._tr_components_for_remit_kind(v_kind);
  IF v_leave_employer_legs_remitted THEN
    v_components := ARRAY(
      SELECT unnest(v_components)
      EXCEPT
      SELECT unnest(ARRAY['ssnit_employer_tier1', 'ssnit_tier2']::text[])
    );
  END IF;

  UPDATE public.tax_ledger_entries t
  SET
    status = 'open',
    remitted_at = NULL,
    notes = public._tr_strip_remitted_note(t.notes),
    updated_at = v_now
  WHERE t.tenant_id = p_tenant_id
    AND t.period_month = v_period_month
    AND t.status = 'paid'
    AND t.tax_component = ANY (v_components)
    AND public._tr_bu_scope_matches(t.business_unit_id, p_business_unit_id)
    AND (v_kind <> 'wht' OR t.direction = 'wht_payable');

  GET DIAGNOSTICS v_legs_reopened = ROW_COUNT;

  RETURN jsonb_build_object(
    'error', NULL,
    'kind', v_kind,
    'periodMonth', to_char(v_period_month, 'YYYY-MM-DD'),
    'legsReopened', v_legs_reopened,
    'cashAmountReversed', v_cash_amount,
    'expenseReceiptNo', v_receipt_no,
    'expenseDeleted', true,
    'essnitRestored', v_essnit_restored,
    'message', format(
      'Undid %s remit for %s: deleted Cash Position outflow %s (%s), reopened %s leg(s).%s',
      v_label,
      v_period_label,
      to_char(v_cash_amount, 'FM999999990.00'),
      v_receipt_no,
      v_legs_reopened,
      CASE
        WHEN v_essnit_restored = 'accrued' THEN ' Employer SSNIT expense restored to Accrued - Not Yet Paid.'
        WHEN v_essnit_restored = 'left_paid' THEN ' Employer SSNIT Mark-as-Paid cash left intact (employer remitted legs unchanged).'
        ELSE ''
      END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.remit_tax_for_period(uuid, uuid, date, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_remit_tax_for_period(uuid, uuid, date, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.remit_tax_for_period(uuid, uuid, date, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.undo_remit_tax_for_period(uuid, uuid, date, text)
  TO service_role;

COMMIT;
