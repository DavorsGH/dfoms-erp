-- Atomic purchase tax replace + Accounts Payable + Fixed Assets save/delete RPCs.
-- Mirrors replace_income_register_tax_ledger_entries (246/265) and 279/280/281 pattern.

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared helpers (private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pur_round_currency(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(coalesce(p_value, 0)::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._pur_normalize_category(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_value, '')));
$$;

CREATE OR REPLACE FUNCTION public._pur_is_fixed_asset_credit_payable(
  p_source_type text,
  p_invoice_number text,
  p_expense_category text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    lower(btrim(coalesce(p_source_type, ''))) = 'fixed_asset'
    OR upper(btrim(coalesce(p_invoice_number, ''))) LIKE 'FAP-%'
    OR public._pur_normalize_category(p_expense_category) = public._pur_normalize_category('Fixed Assets');
$$;

CREATE OR REPLACE FUNCTION public._pur_is_statutory_remittance_payable(
  p_vendor_name text,
  p_invoice_number text,
  p_expense_category text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    upper(btrim(coalesce(p_vendor_name, ''))) IN ('SSNIT', 'GRA')
    OR btrim(coalesce(p_expense_category, '')) IN ('Statutory - SSNIT', 'Statutory - PAYE')
    OR upper(btrim(coalesce(p_invoice_number, ''))) LIKE 'PAYROLL-SSNIT%'
    OR upper(btrim(coalesce(p_invoice_number, ''))) LIKE 'PAYROLL-PAYE%'
    OR upper(btrim(coalesce(p_invoice_number, ''))) LIKE 'PAYROLL-GRA%';
$$;

CREATE OR REPLACE FUNCTION public._pur_should_post_ap_accrual(
  p_source_type text,
  p_invoice_number text,
  p_expense_category text,
  p_vendor_name text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT (
    public._pur_is_fixed_asset_credit_payable(p_source_type, p_invoice_number, p_expense_category)
    OR public._pur_is_statutory_remittance_payable(p_vendor_name, p_invoice_number, p_expense_category)
  );
$$;

CREATE OR REPLACE FUNCTION public._pur_ap_accrual_receipt_no(p_ap_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'AP-ACCRUAL-' || p_ap_id::text;
$$;

CREATE OR REPLACE FUNCTION public._pur_ap_accrual_description(
  p_vendor_name text,
  p_invoice_number text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    'Auto-posted from Accounts Payable — '
    || coalesce(nullif(btrim(p_vendor_name), ''), 'Vendor')
    || ' — Inv '
    || coalesce(nullif(btrim(p_invoice_number), ''), '—');
$$;

CREATE OR REPLACE FUNCTION public._pur_resolve_accrual_payment_status(p_expense_category text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public._pur_normalize_category(p_expense_category) = public._pur_normalize_category('Staff Salaries')
      THEN 'Settled (No Cash Impact)'
    ELSE 'Accrued - Not Yet Paid'
  END;
$$;

CREATE OR REPLACE FUNCTION public._pur_lookup_purchase_source_context(
  p_source_type text,
  p_source_id text
)
RETURNS TABLE(business_unit_id uuid, tenant_id uuid)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF coalesce(btrim(p_source_type), '') = 'fixed_asset' THEN
    RETURN QUERY
    SELECT fa.business_unit_id, fa.tenant_id
    FROM public.fixed_assets fa
    WHERE fa.asset_id = p_source_id
    LIMIT 1;
    RETURN;
  END IF;

  IF coalesce(btrim(p_source_type), '') = 'expense_register' THEN
    RETURN QUERY
    SELECT er.business_unit_id, er.tenant_id
    FROM public.expense_register er
    WHERE er.id::text = p_source_id
    LIMIT 1;
    RETURN;
  END IF;

  IF coalesce(btrim(p_source_type), '') = 'accounts_payable' THEN
    RETURN QUERY
    SELECT ap.business_unit_id, ap.tenant_id
    FROM public.accounts_payable ap
    WHERE ap.id::text = p_source_id
    LIMIT 1;
    RETURN;
  END IF;

  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public._pur_lookup_purchase_business_unit_id(
  p_source_type text,
  p_source_id text
)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT business_unit_id
  FROM public._pur_lookup_purchase_source_context(p_source_type, p_source_id)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._pur_delete_tax_ledger_for_source(
  p_source_type text,
  p_source_id text
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.tax_ledger_entries t
  WHERE t.source_type = p_source_type
    AND t.source_id = p_source_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public._pur_delete_ap_accrual_expense(
  p_tenant_id uuid,
  p_ap_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_no text;
  v_deleted integer := 0;
BEGIN
  v_receipt_no := public._pur_ap_accrual_receipt_no(p_ap_id);

  DELETE FROM public.expense_register er
  WHERE er.receipt_no = v_receipt_no
    AND (p_tenant_id IS NULL OR er.tenant_id = p_tenant_id);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public._pur_post_ap_accrual_expense(
  p_tenant_id uuid,
  p_ap_id uuid,
  p_vendor_name text,
  p_invoice_number text,
  p_expense_category text,
  p_sub_category text,
  p_invoice_date date,
  p_amount numeric,
  p_net_of_tax_amount numeric,
  p_gross_before_wht numeric,
  p_wht_rate numeric,
  p_wht_amount numeric,
  p_input_vat_amount numeric,
  p_business_unit_id uuid,
  p_source_type text
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_receipt_no text;
  v_existing record;
  v_expense_id uuid;
  v_payment_status text;
  v_description text;
  v_category text;
  v_sub_category text;
  v_amount numeric;
  v_net numeric;
  v_gross numeric;
  v_wht_amt numeric;
  v_vat_amt numeric;
BEGIN
  IF NOT public._pur_should_post_ap_accrual(
    p_source_type,
    p_invoice_number,
    p_expense_category,
    p_vendor_name
  ) THEN
    RETURN jsonb_build_object(
      'status', 'skipped',
      'reason', CASE
        WHEN public._pur_is_fixed_asset_credit_payable(p_source_type, p_invoice_number, p_expense_category)
          THEN 'fixed_asset_credit'
        ELSE 'statutory_remittance'
      END,
      'expenseId', NULL,
      'receiptNo', NULL
    );
  END IF;

  v_receipt_no := public._pur_ap_accrual_receipt_no(p_ap_id);
  v_payment_status := public._pur_resolve_accrual_payment_status(p_expense_category);
  v_description := public._pur_ap_accrual_description(p_vendor_name, p_invoice_number);
  v_category := coalesce(nullif(btrim(p_expense_category), ''), 'Administrative');
  v_sub_category := coalesce(nullif(btrim(p_sub_category), ''), 'General');
  v_amount := public._pur_round_currency(p_amount);
  v_net := public._pur_round_currency(coalesce(p_net_of_tax_amount, p_amount));
  v_gross := public._pur_round_currency(coalesce(p_gross_before_wht, p_amount));
  v_wht_amt := public._pur_round_currency(coalesce(p_wht_amount, 0));
  v_vat_amt := public._pur_round_currency(coalesce(p_input_vat_amount, 0));

  SELECT
    er.id,
    er.amount,
    er.net_of_tax_amount,
    er.expense_category,
    er.description,
    er.date
  INTO v_existing
  FROM public.expense_register er
  WHERE er.receipt_no = v_receipt_no
    AND (p_tenant_id IS NULL OR er.tenant_id = p_tenant_id)
  LIMIT 1;

  IF FOUND THEN
    IF
      public._pur_round_currency(v_existing.amount) = v_amount
      AND public._pur_round_currency(coalesce(v_existing.net_of_tax_amount, 0)) = v_net
      AND v_existing.expense_category = v_category
      AND v_existing.description = v_description
      AND v_existing.date = p_invoice_date
    THEN
      RETURN jsonb_build_object(
        'status', 'unchanged',
        'reason', NULL,
        'expenseId', v_existing.id,
        'receiptNo', v_receipt_no
      );
    END IF;

    UPDATE public.expense_register er
    SET
      date = p_invoice_date,
      expense_category = v_category,
      sub_category = v_sub_category,
      description = v_description,
      vendor = nullif(btrim(p_vendor_name), ''),
      price = v_gross,
      quantity = 1,
      amount = v_amount,
      payment_method = 'Accrual',
      approved_by = 'System',
      gross_before_wht = v_gross,
      wht_rate = CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
      wht_amount = v_wht_amt,
      input_vat_amount = v_vat_amt,
      net_of_tax_amount = v_net,
      notes = 'Non-cash AP accrual; cash settles only via Accounts Payable Record Payment. Do not Mark Paid.',
      business_unit_id = p_business_unit_id
    WHERE er.id = v_existing.id;

    RETURN jsonb_build_object(
      'status', 'updated',
      'reason', NULL,
      'expenseId', v_existing.id,
      'receiptNo', v_receipt_no
    );
  END IF;

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
    gross_before_wht,
    wht_rate,
    wht_amount,
    input_vat_amount,
    net_of_tax_amount,
    notes,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_invoice_date,
    v_category,
    v_sub_category,
    v_description,
    nullif(btrim(p_vendor_name), ''),
    v_gross,
    1,
    v_amount,
    'Accrual',
    'System',
    v_receipt_no,
    v_payment_status,
    v_gross,
    CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
    v_wht_amt,
    v_vat_amt,
    v_net,
    'Non-cash AP accrual; cash settles only via Accounts Payable Record Payment. Do not Mark Paid.',
    p_business_unit_id
  )
  RETURNING id INTO v_expense_id;

  RETURN jsonb_build_object(
    'status', 'inserted',
    'reason', NULL,
    'expenseId', v_expense_id,
    'receiptNo', v_receipt_no
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC: replace_purchase_tax_ledger_entries
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
-- Public RPC: save_accounts_payable
-- ---------------------------------------------------------------------------

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
  p_tax_rows jsonb
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
      NULL
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
  numeric, numeric, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_accounts_payable(
  uuid, uuid, uuid, text, text, text, text, text, date, date,
  numeric, numeric, numeric, text, numeric, numeric, numeric,
  numeric, numeric, text, text, jsonb
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: delete_accounts_payable
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_accounts_payable(
  p_tenant_id uuid,
  p_ap_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accrual_deleted integer := 0;
  v_tax_deleted integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_ap_id IS NULL THEN
    RAISE EXCEPTION 'Accounts payable id is required.';
  END IF;

  v_accrual_deleted := public._pur_delete_ap_accrual_expense(p_tenant_id, p_ap_id);

  DELETE FROM public.accounts_payable ap
  WHERE ap.id = p_ap_id
    AND ap.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounts payable entry not found.';
  END IF;

  v_tax_deleted := public._pur_delete_tax_ledger_for_source('accounts_payable', p_ap_id::text);

  RETURN jsonb_build_object(
    'deleted', true,
    'accrualDeleted', v_accrual_deleted,
    'taxLegsDeleted', v_tax_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_accounts_payable(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_accounts_payable(uuid, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: save_fixed_asset
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_fixed_asset(
  p_tenant_id uuid,
  p_asset_id text,
  p_is_update boolean,
  p_business_unit_id uuid,
  p_asset_name text,
  p_asset_category text,
  p_purchase_date date,
  p_original_cost numeric,
  p_quantity numeric,
  p_total_cost numeric,
  p_useful_life_years numeric,
  p_depreciation_method text,
  p_annual_depreciation numeric,
  p_accumulated_depreciation numeric,
  p_net_book_value numeric,
  p_location text,
  p_notes text,
  p_payment_method text,
  p_vendor_name text,
  p_approved_by text,
  p_gross_before_wht numeric,
  p_wht_rate numeric,
  p_wht_amount numeric,
  p_input_vat_amount numeric,
  p_net_of_tax_amount numeric,
  p_existing_payable_id uuid,
  p_tax_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_id text := btrim(coalesce(p_asset_id, ''));
  v_payable_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF v_asset_id = '' THEN
    RAISE EXCEPTION 'Asset id is required.';
  END IF;

  IF coalesce(p_is_update, false) THEN
    UPDATE public.fixed_assets fa
    SET
      asset_name = p_asset_name,
      asset_category = p_asset_category,
      purchase_date = p_purchase_date,
      original_cost = p_original_cost,
      quantity = p_quantity,
      total_cost = p_total_cost,
      useful_life_years = p_useful_life_years,
      depreciation_method = p_depreciation_method,
      annual_depreciation = p_annual_depreciation,
      accumulated_depreciation = p_accumulated_depreciation,
      net_book_value = p_net_book_value,
      location = p_location,
      notes = p_notes,
      payment_method = p_payment_method,
      vendor_name = p_vendor_name,
      approved_by = p_approved_by,
      gross_before_wht = p_gross_before_wht,
      wht_rate = CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
      wht_amount = public._pur_round_currency(coalesce(p_wht_amount, 0)),
      input_vat_amount = public._pur_round_currency(coalesce(p_input_vat_amount, 0)),
      net_of_tax_amount = public._pur_round_currency(coalesce(p_net_of_tax_amount, 0))
    WHERE fa.asset_id = v_asset_id
      AND fa.tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fixed asset not found.';
    END IF;
  ELSE
    INSERT INTO public.fixed_assets (
      tenant_id,
      asset_id,
      asset_name,
      asset_category,
      purchase_date,
      original_cost,
      quantity,
      total_cost,
      useful_life_years,
      depreciation_method,
      annual_depreciation,
      accumulated_depreciation,
      net_book_value,
      location,
      notes,
      payment_method,
      vendor_name,
      approved_by,
      gross_before_wht,
      wht_rate,
      wht_amount,
      input_vat_amount,
      net_of_tax_amount,
      business_unit_id
    )
    VALUES (
      p_tenant_id,
      v_asset_id,
      p_asset_name,
      p_asset_category,
      p_purchase_date,
      p_original_cost,
      p_quantity,
      p_total_cost,
      p_useful_life_years,
      p_depreciation_method,
      p_annual_depreciation,
      p_accumulated_depreciation,
      p_net_book_value,
      p_location,
      p_notes,
      p_payment_method,
      p_vendor_name,
      p_approved_by,
      p_gross_before_wht,
      CASE WHEN coalesce(p_wht_rate, 0) > 0 THEN p_wht_rate ELSE NULL END,
      public._pur_round_currency(coalesce(p_wht_amount, 0)),
      public._pur_round_currency(coalesce(p_input_vat_amount, 0)),
      public._pur_round_currency(coalesce(p_net_of_tax_amount, 0)),
      p_business_unit_id
    );
  END IF;

  v_payable_id := public.sync_fixed_asset_payable(
    p_tenant_id,
    v_asset_id,
    p_vendor_name,
    p_purchase_date,
    p_payment_method,
    p_total_cost,
    p_asset_name,
    p_existing_payable_id
  );

  UPDATE public.fixed_assets fa
  SET accounts_payable_id = v_payable_id
  WHERE fa.asset_id = v_asset_id
    AND fa.tenant_id = p_tenant_id;

  PERFORM public.replace_purchase_tax_ledger_entries(
    'fixed_asset',
    v_asset_id,
    p_tax_rows
  );

  RETURN jsonb_build_object(
    'assetId', v_asset_id,
    'accountsPayableId', v_payable_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_fixed_asset(
  uuid, text, boolean, uuid, text, text, date, numeric, numeric, numeric,
  numeric, text, numeric, numeric, numeric, text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_fixed_asset(
  uuid, text, boolean, uuid, text, text, date, numeric, numeric, numeric,
  numeric, text, numeric, numeric, numeric, text, text, text, text, text,
  numeric, numeric, numeric, numeric, numeric, uuid, jsonb
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPC: delete_fixed_asset
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_fixed_asset(
  p_tenant_id uuid,
  p_asset_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_id text := btrim(coalesce(p_asset_id, ''));
  v_payable_id uuid;
  v_tax_deleted integer := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF v_asset_id = '' THEN
    RAISE EXCEPTION 'Asset id is required.';
  END IF;

  SELECT fa.accounts_payable_id
  INTO v_payable_id
  FROM public.fixed_assets fa
  WHERE fa.asset_id = v_asset_id
    AND fa.tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fixed asset not found.';
  END IF;

  DELETE FROM public.fixed_assets fa
  WHERE fa.asset_id = v_asset_id
    AND fa.tenant_id = p_tenant_id;

  IF v_payable_id IS NOT NULL THEN
    PERFORM public.reverse_fixed_asset_payable(v_payable_id);
  END IF;

  v_tax_deleted := public._pur_delete_tax_ledger_for_source('fixed_asset', v_asset_id);

  RETURN jsonb_build_object(
    'deleted', true,
    'accountsPayableReversed', v_payable_id IS NOT NULL,
    'taxLegsDeleted', v_tax_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_fixed_asset(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_fixed_asset(uuid, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
