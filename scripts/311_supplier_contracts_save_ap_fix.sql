BEGIN;

DROP FUNCTION IF EXISTS public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb
);

DROP FUNCTION IF EXISTS public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb, text
);

CREATE OR REPLACE FUNCTION public.save_accounts_payable(
  p_tenant_id uuid,
  p_ap_id uuid,
  p_business_unit_id uuid,
  p_vendor_name text,
  p_invoice_number text,
  p_expense_category text,
  p_sub_category text,
  p_description text,
  p_invoice_date date,
  p_due_date date,
  p_amount numeric,
  p_amount_paid numeric,
  p_balance_due numeric,
  p_status text,
  p_gross_before_wht numeric,
  p_wht_rate numeric,
  p_wht_amount numeric,
  p_input_vat_amount numeric,
  p_net_of_tax_amount numeric,
  p_notes text,
  p_source_type text,
  p_tax_rows jsonb,
  p_source_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap_id uuid;
  v_source_type text;
  v_accrual jsonb;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_invoice_date IS NULL OR p_due_date IS NULL THEN
    RAISE EXCEPTION 'Invoice and due dates are required.';
  END IF;

  v_source_type := nullif(btrim(coalesce(p_source_type, '')), '');

  IF p_ap_id IS NOT NULL THEN
    UPDATE public.accounts_payable ap
    SET
      vendor_name = p_vendor_name,
      invoice_number = p_invoice_number,
      expense_category = p_expense_category,
      sub_category = p_sub_category,
      description = p_description,
      invoice_date = p_invoice_date,
      due_date = p_due_date,
      amount = public._pur_round_currency(p_amount),
      amount_paid = coalesce(p_amount_paid, 0),
      balance_due = public._pur_round_currency(p_balance_due),
      status = p_status,
      gross_before_wht = public._pur_round_currency(p_gross_before_wht),
      wht_rate = CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
      wht_amount = public._pur_round_currency(coalesce(p_wht_amount, 0)),
      input_vat_amount = public._pur_round_currency(coalesce(p_input_vat_amount, 0)),
      net_of_tax_amount = public._pur_round_currency(coalesce(p_net_of_tax_amount, p_amount)),
      notes = p_notes
    WHERE ap.id = p_ap_id
      AND ap.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Accounts payable entry not found.';
    END IF;

    v_ap_id := p_ap_id;

    IF v_source_type IS NULL THEN
      SELECT ap.source_type INTO v_source_type
      FROM public.accounts_payable ap
      WHERE ap.id = v_ap_id;
    END IF;
  ELSE
    INSERT INTO public.accounts_payable (
      tenant_id,
      vendor_name,
      invoice_number,
      expense_category,
      sub_category,
      description,
      invoice_date,
      due_date,
      amount,
      amount_paid,
      balance_due,
      status,
      gross_before_wht,
      wht_rate,
      wht_amount,
      input_vat_amount,
      net_of_tax_amount,
      notes,
      business_unit_id,
      source_type,
      source_id
    )
    VALUES (
      p_tenant_id,
      p_vendor_name,
      p_invoice_number,
      p_expense_category,
      p_sub_category,
      p_description,
      p_invoice_date,
      p_due_date,
      public._pur_round_currency(p_amount),
      coalesce(p_amount_paid, 0),
      public._pur_round_currency(p_balance_due),
      p_status,
      public._pur_round_currency(p_gross_before_wht),
      CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
      public._pur_round_currency(coalesce(p_wht_amount, 0)),
      public._pur_round_currency(coalesce(p_input_vat_amount, 0)),
      public._pur_round_currency(coalesce(p_net_of_tax_amount, p_amount)),
      p_notes,
      p_business_unit_id,
      v_source_type,
      p_source_id
    )
    RETURNING id INTO v_ap_id;
  END IF;

  v_accrual := public._pur_post_ap_accrual_expense(
    p_tenant_id,
    v_ap_id,
    p_vendor_name,
    p_invoice_number,
    p_expense_category,
    p_sub_category,
    p_invoice_date,
    p_amount,
    p_net_of_tax_amount,
    p_gross_before_wht,
    p_wht_rate,
    p_wht_amount,
    p_input_vat_amount,
    p_business_unit_id,
    v_source_type
  );

  PERFORM public.replace_purchase_tax_ledger_entries(
    'accounts_payable',
    v_ap_id::text,
    p_tax_rows
  );

  RETURN jsonb_build_object(
    'id', v_ap_id,
    'accrualStatus', v_accrual->>'status',
    'accrualReason', v_accrual->>'reason',
    'accrualExpenseId', v_accrual->>'expenseId',
    'accrualReceiptNo', v_accrual->>'receiptNo'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb, text
) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb, text
) FROM anon;

CREATE OR REPLACE FUNCTION public.record_supplier_contract_replacement_payment(
  p_tenant_id uuid,
  p_contract_id uuid,
  p_created_by uuid,
  p_service_date date,
  p_replacement_name text,
  p_deduction_amount numeric,
  p_payment_method text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract public.supplier_contracts%ROWTYPE;
  v_billing_month date;
  v_ap public.accounts_payable%ROWTYPE;
  v_remaining numeric;
  v_applied numeric;
  v_carried numeric;
  v_expense_id uuid;
  v_receipt text;
  v_deduction_id uuid;
  v_new_gross numeric;
  v_wht_amount numeric;
  v_net numeric;
  v_balance numeric;
  v_status text;
  v_tax_rows jsonb;
  v_save jsonb;
BEGIN
  IF p_tenant_id IS NULL OR p_contract_id IS NULL THEN
    RAISE EXCEPTION 'Tenant and contract are required.';
  END IF;

  IF coalesce(p_deduction_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Deduction amount must be positive.';
  END IF;

  SELECT * INTO v_contract
  FROM public.supplier_contracts sc
  WHERE sc.id = p_contract_id
    AND sc.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier contract not found.';
  END IF;

  v_billing_month := date_trunc('month', p_service_date)::date;

  v_receipt := public.generate_next_code(p_tenant_id, 'EXP', 4);
  IF coalesce(v_receipt, '') = '' THEN
    RAISE EXCEPTION 'Unable to allocate expense receipt number.';
  END IF;

  v_expense_id := gen_random_uuid();
  INSERT INTO public.expense_register (
    id,
    tenant_id,
    business_unit_id,
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
    gross_before_wht,
    wht_rate,
    wht_amount,
    input_vat_amount,
    net_of_tax_amount,
    notes
  )
  VALUES (
    v_expense_id,
    p_tenant_id,
    v_contract.business_unit_id,
    p_service_date,
    v_contract.expense_category,
    v_contract.sub_category,
    coalesce(p_notes, 'Replacement payment'),
    coalesce(nullif(btrim(p_replacement_name), ''), 'Replacement'),
    public._pur_round_currency(p_deduction_amount),
    1,
    public._pur_round_currency(p_deduction_amount),
    coalesce(nullif(btrim(p_payment_method), ''), 'company_cash'),
    'System',
    v_receipt,
    'Paid',
    public._pur_round_currency(p_deduction_amount),
    NULL,
    0,
    0,
    public._pur_round_currency(p_deduction_amount),
    p_notes
  );

  PERFORM public.replace_purchase_tax_ledger_entries(
    'expense_register',
    v_expense_id::text,
    '[]'::jsonb
  );

  SELECT * INTO v_ap
  FROM public.accounts_payable ap
  WHERE ap.tenant_id = p_tenant_id
    AND ap.source_type = 'supplier_contract'
    AND ap.source_id = p_contract_id::text
    AND ap.invoice_date = v_billing_month
  LIMIT 1
  FOR UPDATE;

  v_applied := 0;
  v_carried := public._pur_round_currency(p_deduction_amount);

  IF FOUND THEN
    v_remaining := public._pur_round_currency(
      greatest(
        coalesce(v_ap.balance_due, v_ap.amount - coalesce(v_ap.amount_paid, 0)),
        0
      )
    );
    v_applied := public._pur_round_currency(least(p_deduction_amount, v_remaining));
    v_carried := public._pur_round_currency(p_deduction_amount - v_applied);

    IF v_applied > 0 THEN
      v_new_gross := public._pur_round_currency(
        greatest(coalesce(v_ap.gross_before_wht, v_ap.amount) - v_applied, 0)
      );
      v_wht_amount := CASE
        WHEN coalesce(v_contract.wht_rate, 0) > 0 THEN
          public._pur_round_currency(v_new_gross * v_contract.wht_rate / 100.0)
        ELSE 0
      END;
      v_net := public._pur_round_currency(v_new_gross - v_wht_amount);
      v_balance := public._pur_round_currency(
        greatest(v_net - coalesce(v_ap.amount_paid, 0), 0)
      );
      v_status := CASE
        WHEN v_balance <= 0.005 THEN 'Paid'
        WHEN coalesce(v_ap.amount_paid, 0) > 0 THEN 'Partially Paid'
        ELSE 'Outstanding'
      END;

      IF coalesce(v_contract.wht_rate, 0) > 0 AND v_wht_amount > 0 THEN
        v_tax_rows := jsonb_build_array(
          jsonb_build_object(
            'tenant_id', p_tenant_id,
            'entry_date', v_ap.invoice_date,
            'period_month', date_trunc('month', v_ap.invoice_date)::date,
            'direction', 'wht_payable',
            'tax_component', 'wht',
            'rate_pct', v_contract.wht_rate,
            'taxable_base', v_new_gross,
            'tax_amount', v_wht_amount,
            'status', 'open',
            'counterparty_name', v_ap.vendor_name,
            'notes', coalesce('Supplier contract ' || v_contract.contract_number, v_ap.invoice_number)
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
        v_new_gross,
        CASE WHEN coalesce(v_contract.wht_rate, 0) > 0 THEN v_contract.wht_rate ELSE NULL END,
        v_wht_amount,
        coalesce(v_ap.input_vat_amount, 0),
        v_net,
        v_ap.notes,
        'supplier_contract',
        v_tax_rows,
        v_ap.source_id
      );
    END IF;
  END IF;

  IF v_carried > 0 THEN
    UPDATE public.supplier_contracts sc
    SET
      credit_balance = public._pur_round_currency(coalesce(sc.credit_balance, 0) + v_carried),
      updated_at = now()
    WHERE sc.id = p_contract_id
      AND sc.tenant_id = p_tenant_id;
  END IF;

  v_deduction_id := gen_random_uuid();
  INSERT INTO public.supplier_contract_deductions (
    id,
    tenant_id,
    business_unit_id,
    contract_id,
    service_date,
    billing_month,
    accounts_payable_id,
    replacement_expense_id,
    replacement_name,
    deduction_amount,
    amount_applied,
    amount_carried_forward,
    notes,
    created_by
  )
  VALUES (
    v_deduction_id,
    p_tenant_id,
    v_contract.business_unit_id,
    p_contract_id,
    p_service_date,
    v_billing_month,
    CASE WHEN v_ap.id IS NULL THEN NULL ELSE v_ap.id END,
    v_expense_id,
    coalesce(nullif(btrim(p_replacement_name), ''), 'Replacement'),
    public._pur_round_currency(p_deduction_amount),
    v_applied,
    v_carried,
    p_notes,
    p_created_by
  );

  RETURN jsonb_build_object(
    'deduction_id', v_deduction_id,
    'expense_id', v_expense_id,
    'receipt_no', v_receipt,
    'accounts_payable_id', v_ap.id,
    'amount_applied', v_applied,
    'amount_carried_forward', v_carried,
    'ap_save', v_save
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_supplier_contract_replacement_payment(
  uuid, uuid, uuid, date, text, numeric, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_supplier_contract_replacement_payment(
  uuid, uuid, uuid, date, text, numeric, text, text
) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.record_supplier_contract_replacement_payment(
  uuid, uuid, uuid, date, text, numeric, text, text
) FROM anon;

CREATE OR REPLACE FUNCTION public.trg_pur_accounts_payable_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._pur_delete_ap_accrual_expense(OLD.tenant_id, OLD.id);
  PERFORM public._pur_delete_tax_ledger_for_source('accounts_payable', OLD.id::text);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_payable_pur_before_delete ON public.accounts_payable;
CREATE TRIGGER trg_accounts_payable_pur_before_delete
  BEFORE DELETE ON public.accounts_payable
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pur_accounts_payable_before_delete();

COMMIT;

SELECT p.oid::regprocedure AS save_ap_signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'save_accounts_payable'
ORDER BY 1;
