BEGIN;

CREATE OR REPLACE FUNCTION public._sync_accounts_payable_accrual_from_ap_row(
  p_tenant_id uuid,
  p_accounts_payable_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_accrual jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_accounts_payable_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_ids');
  END IF;

  SELECT *
  INTO v_ap
  FROM public.accounts_payable ap
  WHERE ap.id = p_accounts_payable_id
    AND ap.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ap_not_found');
  END IF;

  v_accrual := public._pur_post_ap_accrual_expense(
    v_ap.tenant_id,
    v_ap.id,
    v_ap.vendor_name,
    v_ap.invoice_number,
    v_ap.expense_category,
    v_ap.sub_category,
    v_ap.invoice_date,
    v_ap.amount,
    v_ap.net_of_tax_amount,
    v_ap.gross_before_wht,
    v_ap.wht_rate,
    v_ap.wht_amount,
    v_ap.input_vat_amount,
    v_ap.business_unit_id,
    v_ap.source_type
  );

  RETURN jsonb_build_object(
    'skipped', false,
    'accounts_payable_id', v_ap.id,
    'accrual', v_accrual
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._recalculate_ap_from_supplier_contract_deductions(
  p_tenant_id uuid,
  p_accounts_payable_id uuid,
  p_restored_applied numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_ap public.accounts_payable%ROWTYPE;
  v_applied_sum numeric;
  v_full_gross numeric;
  v_target_gross numeric;
  v_wht_rate numeric;
  v_wht_amount numeric;
  v_net numeric;
  v_balance numeric;
  v_status text;
  v_tax_rows jsonb;
  v_save jsonb;
  v_contract public.supplier_contracts%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL OR p_accounts_payable_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'missing_ids');
  END IF;

  SELECT *
  INTO v_ap
  FROM public.accounts_payable ap
  WHERE ap.id = p_accounts_payable_id
    AND ap.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ap_not_found');
  END IF;

  SELECT coalesce(sum(d.amount_applied), 0)
  INTO v_applied_sum
  FROM public.supplier_contract_deductions d
  WHERE d.tenant_id = p_tenant_id
    AND d.accounts_payable_id = p_accounts_payable_id;

  v_applied_sum := public._pur_round_currency(coalesce(v_applied_sum, 0));

  IF v_applied_sum <= 0 AND coalesce(p_restored_applied, 0) <= 0 THEN
    RETURN public._sync_accounts_payable_accrual_from_ap_row(
      p_tenant_id,
      p_accounts_payable_id
    );
  END IF;

  v_full_gross := public._pur_round_currency(
    coalesce(v_ap.gross_before_wht, v_ap.amount, 0)
    + v_applied_sum
    + coalesce(p_restored_applied, 0)
  );
  v_target_gross := public._pur_round_currency(
    greatest(v_full_gross - v_applied_sum, 0)
  );

  v_wht_rate := 0;
  IF v_ap.source_type = 'supplier_contract' AND v_ap.source_id IS NOT NULL THEN
    SELECT sc.wht_rate
    INTO v_wht_rate
    FROM public.supplier_contracts sc
    WHERE sc.tenant_id = p_tenant_id
      AND sc.id::text = v_ap.source_id;
  END IF;

  v_wht_amount := CASE
    WHEN coalesce(v_wht_rate, 0) > 0 THEN
      public._pur_round_currency(v_target_gross * v_wht_rate / 100.0)
    ELSE 0
  END;
  v_net := public._pur_round_currency(v_target_gross - v_wht_amount);
  v_balance := public._pur_round_currency(
    greatest(v_net - coalesce(v_ap.amount_paid, 0), 0)
  );
  v_status := CASE
    WHEN v_balance <= 0.005 THEN 'Paid'
    WHEN coalesce(v_ap.amount_paid, 0) > 0 THEN 'Partially Paid'
    ELSE 'Outstanding'
  END;

  IF coalesce(v_wht_rate, 0) > 0 AND v_wht_amount > 0 THEN
    v_tax_rows := jsonb_build_array(
      jsonb_build_object(
        'tenant_id', p_tenant_id,
        'entry_date', v_ap.invoice_date,
        'period_month', date_trunc('month', v_ap.invoice_date)::date,
        'direction', 'wht_payable',
        'tax_component', 'wht',
        'rate_pct', v_wht_rate,
        'taxable_base', v_target_gross,
        'tax_amount', v_wht_amount,
        'status', 'open',
        'counterparty_name', v_ap.vendor_name,
        'notes', coalesce(v_ap.invoice_number, 'Supplier contract AP')
      )
    );
  ELSE
    v_tax_rows := '[]'::jsonb;
  END IF;

  v_save := public.save_accounts_payable(
    p_tenant_id,
    v_ap.id,
    v_ap.business_unit_id,
    v_ap.vendor_name,
    v_ap.invoice_number,
    v_ap.expense_category,
    v_ap.sub_category,
    v_ap.description,
    v_ap.invoice_date,
    v_ap.due_date,
    v_net,
    coalesce(v_ap.amount_paid, 0),
    v_balance,
    v_status,
    v_target_gross,
    CASE WHEN coalesce(v_wht_rate, 0) > 0 THEN v_wht_rate ELSE NULL END,
    v_wht_amount,
    coalesce(v_ap.input_vat_amount, 0),
    v_net,
    v_ap.notes,
    v_ap.source_type,
    v_tax_rows,
    v_ap.source_id
  );

  RETURN jsonb_build_object(
    'skipped', false,
    'accounts_payable_id', v_ap.id,
    'applied_deductions_total', v_applied_sum,
    'target_gross', v_target_gross,
    'ap_save', v_save
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_accounts_payable_accrual_from_ap(
  p_tenant_id uuid,
  p_accounts_payable_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);
  RETURN public._sync_accounts_payable_accrual_from_ap_row(
    p_tenant_id,
    p_accounts_payable_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_accounts_payable_accrual_after_deductions(
  p_tenant_id uuid,
  p_accounts_payable_id uuid,
  p_restored_applied numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);
  RETURN public._recalculate_ap_from_supplier_contract_deductions(
    p_tenant_id,
    p_accounts_payable_id,
    p_restored_applied
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_supplier_contract_deductions_sync_ap_accrual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_ap_id uuid;
  v_tenant_id uuid;
  v_restored numeric := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ap_id := OLD.accounts_payable_id;
    v_tenant_id := OLD.tenant_id;
    IF v_ap_id IS NULL OR coalesce(OLD.amount_applied, 0) <= 0 THEN
      RETURN OLD;
    END IF;
    v_restored := OLD.amount_applied;
    PERFORM public._recalculate_ap_from_supplier_contract_deductions(
      v_tenant_id,
      v_ap_id,
      v_restored
    );
    RETURN OLD;
  END IF;

  v_ap_id := NEW.accounts_payable_id;
  v_tenant_id := NEW.tenant_id;

  IF v_ap_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF coalesce(NEW.amount_applied, 0) <= 0 AND coalesce(OLD.amount_applied, 0) <= 0 THEN
      RETURN NEW;
    END IF;
    IF coalesce(NEW.amount_applied, 0) < coalesce(OLD.amount_applied, 0) THEN
      v_restored := public._pur_round_currency(
        coalesce(OLD.amount_applied, 0) - coalesce(NEW.amount_applied, 0)
      );
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.amount_applied, 0) <= 0 THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public._recalculate_ap_from_supplier_contract_deductions(
    v_tenant_id,
    v_ap_id,
    v_restored
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_contract_deductions_sync_ap_accrual
  ON public.supplier_contract_deductions;

CREATE TRIGGER trg_supplier_contract_deductions_sync_ap_accrual
  AFTER INSERT OR UPDATE OF amount_applied, accounts_payable_id OR DELETE
  ON public.supplier_contract_deductions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_supplier_contract_deductions_sync_ap_accrual();

CREATE OR REPLACE FUNCTION public.audit_tenant_ap_accrual_mismatch(
  p_tenant_id uuid
)
RETURNS TABLE (
  accounts_payable_id uuid,
  invoice_number text,
  ap_amount numeric,
  ap_gross_before_wht numeric,
  applied_deductions_total numeric,
  expected_accrual_amount numeric,
  expected_accrual_gross numeric,
  expense_id uuid,
  expense_amount numeric,
  expense_gross_before_wht numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ap.id AS accounts_payable_id,
    ap.invoice_number,
    public._pur_round_currency(ap.amount) AS ap_amount,
    public._pur_round_currency(coalesce(ap.gross_before_wht, ap.amount)) AS ap_gross_before_wht,
    public._pur_round_currency(coalesce(ded.applied_total, 0)) AS applied_deductions_total,
    public._pur_round_currency(ap.amount) AS expected_accrual_amount,
    public._pur_round_currency(coalesce(ap.gross_before_wht, ap.amount)) AS expected_accrual_gross,
    er.id AS expense_id,
    public._pur_round_currency(coalesce(er.amount, 0)) AS expense_amount,
    public._pur_round_currency(coalesce(er.gross_before_wht, er.amount, 0)) AS expense_gross_before_wht
  FROM public.accounts_payable ap
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(d.amount_applied), 0) AS applied_total
    FROM public.supplier_contract_deductions d
    WHERE d.tenant_id = ap.tenant_id
      AND d.accounts_payable_id = ap.id
  ) ded ON true
  LEFT JOIN public.expense_register er
    ON er.tenant_id = ap.tenant_id
    AND er.receipt_no = public._pur_ap_accrual_receipt_no(ap.id)
  WHERE ap.tenant_id = p_tenant_id
    AND public._pur_should_post_ap_accrual(
      ap.source_type,
      ap.invoice_number,
      ap.expense_category,
      ap.vendor_name
    )
    AND (
      er.id IS NULL
      OR abs(public._pur_round_currency(coalesce(er.amount, 0)) - public._pur_round_currency(ap.amount)) > 0.01
      OR abs(
        public._pur_round_currency(coalesce(er.gross_before_wht, er.amount, 0))
        - public._pur_round_currency(coalesce(ap.gross_before_wht, ap.amount))
      ) > 0.01
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.repair_tenant_ap_accrual_sync(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row record;
  v_repaired integer := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  FOR v_row IN
    SELECT m.accounts_payable_id
    FROM public.audit_tenant_ap_accrual_mismatch(p_tenant_id) m
  LOOP
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'accounts_payable_id', v_row.accounts_payable_id,
        'result', public._recalculate_ap_from_supplier_contract_deductions(
          p_tenant_id,
          v_row.accounts_payable_id,
          0
        )
      )
    );
    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'repaired_count', v_repaired,
    'details', v_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._sync_accounts_payable_accrual_from_ap_row(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sync_accounts_payable_accrual_from_ap_row(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public._recalculate_ap_from_supplier_contract_deductions(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recalculate_ap_from_supplier_contract_deductions(uuid, uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_accounts_payable_accrual_from_ap(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_accounts_payable_accrual_from_ap(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recalculate_accounts_payable_accrual_after_deductions(uuid, uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_accounts_payable_accrual_after_deductions(uuid, uuid, numeric) TO service_role;

REVOKE EXECUTE ON FUNCTION public.audit_tenant_ap_accrual_mismatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_tenant_ap_accrual_mismatch(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.repair_tenant_ap_accrual_sync(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_tenant_ap_accrual_sync(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_supplier_contract_deductions_sync_ap_accrual() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_supplier_contract_deductions_sync_ap_accrual() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
