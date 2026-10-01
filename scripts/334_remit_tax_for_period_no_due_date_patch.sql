BEGIN;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
