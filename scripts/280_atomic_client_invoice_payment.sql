-- Atomic client invoice payment record / void (single-transaction RPCs).
-- Mirrors utils/client-invoice-payments-api.ts + syncIncomeRegisterFromClientInvoice
-- + syncIncomeRegisterTaxLedger (replace_income_register_tax_ledger_entries).

BEGIN;

-- ---------------------------------------------------------------------------
-- Shared helpers (private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._cip_round_money(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(coalesce(p_value, 0)::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._cip_nullable_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(btrim(coalesce(p_value, '')), '');
$$;

CREATE OR REPLACE FUNCTION public._cip_period_month(p_entry_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (to_char(p_entry_date, 'YYYY-MM') || '-01')::date;
$$;

CREATE OR REPLACE FUNCTION public._cip_net_cash_due(p_total_due numeric, p_wht_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._cip_round_money(
    greatest(0, coalesce(p_total_due, 0) - coalesce(p_wht_amount, 0))
  );
$$;

CREATE OR REPLACE FUNCTION public._cip_cash_outstanding(
  p_total_due numeric,
  p_wht_amount numeric,
  p_amount_received numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._cip_round_money(
    greatest(
      0,
      public._cip_net_cash_due(p_total_due, p_wht_amount)
        - coalesce(p_amount_received, 0)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._cip_is_settled_from_payments(
  p_cash_received numeric,
  p_total_due numeric,
  p_wht_amount numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    public._cip_round_money(coalesce(p_cash_received, 0))
    + public._cip_round_money(coalesce(p_wht_amount, 0))
    >= public._cip_round_money(coalesce(p_total_due, 0)) - 0.009;
$$;

CREATE OR REPLACE FUNCTION public._cip_derive_invoice_status_from_payments(
  p_cash_received numeric,
  p_total_due numeric,
  p_wht_amount numeric,
  p_current_status text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN public._cip_round_money(coalesce(p_cash_received, 0)) <= 0 THEN
      CASE WHEN p_current_status = 'draft' THEN 'draft' ELSE 'sent' END
    WHEN public._cip_is_settled_from_payments(
      p_cash_received,
      p_total_due,
      p_wht_amount
    ) THEN 'paid'
    ELSE 'partial'
  END;
$$;

CREATE OR REPLACE FUNCTION public._cip_sum_client_invoice_payments(
  p_tenant_id uuid,
  p_invoice_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT public._cip_round_money(
    coalesce(
      (
        SELECT sum(amount)
        FROM public.client_invoice_payments p
        WHERE p.tenant_id = p_tenant_id
          AND p.invoice_id = p_invoice_id
      ),
      0
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._cip_calculate_income_outstanding(
  p_amount numeric,
  p_amount_received numeric,
  p_wht_amount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._cip_round_money(
    greatest(
      0,
      coalesce(p_amount, 0)
        - coalesce(p_amount_received, 0)
        - coalesce(p_wht_amount, 0)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._cip_find_client_invoice_income_register_id(
  p_tenant_id uuid,
  p_client_invoice_id uuid,
  p_invoice_number text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_income_id uuid;
BEGIN
  IF p_client_invoice_id IS NOT NULL THEN
    SELECT i.id
    INTO v_income_id
    FROM public.income_register i
    WHERE i.tenant_id = p_tenant_id
      AND i.client_invoice_id = p_client_invoice_id
    LIMIT 1;

    IF v_income_id IS NOT NULL THEN
      RETURN v_income_id;
    END IF;
  END IF;

  SELECT i.id
  INTO v_income_id
  FROM public.income_register i
  WHERE i.tenant_id = p_tenant_id
    AND i.invoice_no = p_invoice_number
    AND i.service_category = 'Client Invoice'
  LIMIT 1;

  RETURN v_income_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._cip_build_income_tax_ledger_rows(
  p_tenant_id uuid,
  p_source_id uuid,
  p_entry_date date,
  p_amount numeric,
  p_wht_rate_pct numeric,
  p_wht_amount numeric,
  p_output_tax_component text,
  p_output_tax_rate_pct numeric,
  p_output_vat_amount numeric,
  p_counterparty_name text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rows jsonb := '[]'::jsonb;
  v_period_month date;
  v_amount numeric;
  v_wht_amount numeric;
  v_output_vat_amount numeric;
BEGIN
  v_period_month := public._cip_period_month(p_entry_date);
  v_amount := public._cip_round_money(p_amount);
  v_wht_amount := public._cip_round_money(p_wht_amount);
  v_output_vat_amount := public._cip_round_money(p_output_vat_amount);

  IF v_wht_amount > 0 THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'tenant_id', p_tenant_id,
        'entry_date', p_entry_date,
        'period_month', v_period_month,
        'direction', 'wht_receivable',
        'tax_component', 'wht',
        'rate_pct', CASE
          WHEN p_wht_rate_pct IS NULL THEN NULL
          ELSE public._cip_round_money(p_wht_rate_pct)
        END,
        'taxable_base', v_amount,
        'tax_amount', v_wht_amount,
        'status', 'open',
        'counterparty_name', p_counterparty_name,
        'notes', p_notes
      )
    );
  END IF;

  IF p_output_tax_component IS NOT NULL AND v_output_vat_amount > 0 THEN
    v_rows := v_rows || jsonb_build_array(
      jsonb_build_object(
        'tenant_id', p_tenant_id,
        'entry_date', p_entry_date,
        'period_month', v_period_month,
        'direction', 'output',
        'tax_component', p_output_tax_component,
        'rate_pct', CASE
          WHEN p_output_tax_rate_pct IS NULL THEN NULL
          ELSE public._cip_round_money(p_output_tax_rate_pct)
        END,
        'taxable_base', public._cip_round_money(v_amount - v_output_vat_amount),
        'tax_amount', v_output_vat_amount,
        'status', 'open',
        'counterparty_name', p_counterparty_name,
        'notes', p_notes
      )
    );
  END IF;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public._cip_sync_income_register_from_client_invoice(
  p_tenant_id uuid,
  p_invoice public.client_invoices
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_income_id uuid;
  v_amount numeric;
  v_amount_received numeric;
  v_output_vat_amount numeric;
  v_wht_amount numeric;
  v_outstanding_balance numeric;
  v_payment_status text;
  v_wht_rate numeric;
  v_output_tax_component text;
  v_tax_rows jsonb;
  v_today date := current_date;
  v_due_date date;
BEGIN
  IF p_invoice.status = 'draft' THEN
    v_income_id := public._cip_find_client_invoice_income_register_id(
      p_tenant_id,
      p_invoice.id,
      p_invoice.invoice_number
    );

    IF v_income_id IS NULL THEN
      RETURN NULL;
    END IF;

    DELETE FROM public.income_register
    WHERE id = v_income_id
      AND tenant_id = p_tenant_id;

    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = v_income_id::text;

    RETURN NULL;
  END IF;

  v_amount := public._cip_round_money(p_invoice.total_amount_due);
  v_output_vat_amount := public._cip_round_money(p_invoice.tax_due);
  v_wht_amount := public._cip_round_money(p_invoice.wht_amount);
  v_wht_rate := public._cip_round_money(p_invoice.wht_rate);

  IF p_invoice.status = 'voided' THEN
    v_amount_received := public._cip_round_money(p_invoice.amount_received);
    v_outstanding_balance := 0;
    v_payment_status := 'Voided';
  ELSIF p_invoice.status IN ('paid', 'partial') THEN
    v_amount_received := public._cip_round_money(p_invoice.amount_received);
    v_outstanding_balance := public._cip_calculate_income_outstanding(
      v_amount,
      v_amount_received,
      v_wht_amount
    );
    v_payment_status := CASE
      WHEN p_invoice.status = 'paid' THEN 'Paid'
      ELSE 'Partial'
    END;
  ELSE
    v_amount_received := 0;
    v_outstanding_balance := public._cip_calculate_income_outstanding(
      v_amount,
      0,
      v_wht_amount
    );
    v_due_date := coalesce(p_invoice.due_date, p_invoice.invoice_date);
    v_payment_status := CASE
      WHEN v_due_date IS NOT NULL AND v_due_date < v_today THEN 'Overdue'
      ELSE 'Pending'
    END;
  END IF;

  v_output_tax_component := CASE
    WHEN v_output_vat_amount > 0 THEN 'vat_bundle'
    ELSE NULL
  END;

  v_income_id := public._cip_find_client_invoice_income_register_id(
    p_tenant_id,
    p_invoice.id,
    p_invoice.invoice_number
  );

  IF v_income_id IS NULL THEN
    INSERT INTO public.income_register (
      tenant_id,
      date,
      invoice_no,
      client_invoice_id,
      client_id,
      customer_name,
      entry_type,
      service_category,
      description,
      amount,
      amount_received,
      outstanding_balance,
      tax_inclusive,
      net_of_tax_amount,
      output_tax_component,
      output_vat_amount,
      wht_rate,
      wht_amount,
      payment_status,
      due_date,
      business_unit_id
    )
    VALUES (
      p_tenant_id,
      p_invoice.invoice_date,
      p_invoice.invoice_number,
      p_invoice.id,
      p_invoice.client_id,
      p_invoice.bill_to_name,
      'service'::public.income_entry_type,
      'Client Invoice',
      p_invoice.notes,
      v_amount,
      v_amount_received,
      v_outstanding_balance,
      true,
      public._cip_round_money(v_amount - v_output_vat_amount),
      v_output_tax_component,
      v_output_vat_amount,
      NULLIF(v_wht_rate, 0),
      v_wht_amount,
      v_payment_status,
      coalesce(p_invoice.due_date, p_invoice.invoice_date),
      p_invoice.business_unit_id
    )
    RETURNING id INTO v_income_id;
  ELSE
    UPDATE public.income_register
    SET
      date = p_invoice.invoice_date,
      invoice_no = p_invoice.invoice_number,
      client_invoice_id = p_invoice.id,
      client_id = p_invoice.client_id,
      customer_name = p_invoice.bill_to_name,
      entry_type = 'service'::public.income_entry_type,
      service_category = 'Client Invoice',
      description = p_invoice.notes,
      amount = v_amount,
      amount_received = v_amount_received,
      outstanding_balance = v_outstanding_balance,
      tax_inclusive = true,
      net_of_tax_amount = public._cip_round_money(v_amount - v_output_vat_amount),
      output_tax_component = v_output_tax_component,
      output_vat_amount = v_output_vat_amount,
      wht_rate = NULLIF(v_wht_rate, 0),
      wht_amount = v_wht_amount,
      payment_status = v_payment_status,
      due_date = coalesce(p_invoice.due_date, p_invoice.invoice_date),
      business_unit_id = p_invoice.business_unit_id
    WHERE id = v_income_id
      AND tenant_id = p_tenant_id;
  END IF;

  IF p_invoice.status = 'voided' THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = v_income_id::text;
    RETURN v_income_id;
  END IF;

  v_tax_rows := public._cip_build_income_tax_ledger_rows(
    p_tenant_id,
    v_income_id,
    p_invoice.invoice_date,
    v_amount,
    CASE WHEN v_wht_amount > 0 THEN NULLIF(v_wht_rate, 0) ELSE NULL END,
    v_wht_amount,
    v_output_tax_component,
    CASE WHEN v_output_vat_amount > 0 THEN public._cip_round_money(p_invoice.vat_nhil_getfund_rate) ELSE NULL END,
    v_output_vat_amount,
    p_invoice.bill_to_name,
    'Invoice ' || p_invoice.invoice_number
  );

  PERFORM public.replace_income_register_tax_ledger_entries(
    v_income_id::text,
    v_tax_rows
  );

  RETURN v_income_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._cip_recompute_client_invoice_from_payments(
  p_tenant_id uuid,
  p_invoice_id uuid
)
RETURNS public.client_invoices
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice public.client_invoices;
  v_total numeric;
  v_next_status text;
BEGIN
  SELECT *
  INTO v_invoice
  FROM public.client_invoices ci
  WHERE ci.id = p_invoice_id
    AND ci.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;

  v_total := public._cip_sum_client_invoice_payments(p_tenant_id, p_invoice_id);
  v_next_status := public._cip_derive_invoice_status_from_payments(
    v_total,
    v_invoice.total_amount_due,
    v_invoice.wht_amount,
    v_invoice.status
  );

  UPDATE public.client_invoices ci
  SET
    amount_received = v_total,
    status = v_next_status,
    updated_at = now()
  WHERE ci.id = p_invoice_id
    AND ci.tenant_id = p_tenant_id
  RETURNING * INTO v_invoice;

  PERFORM public._cip_sync_income_register_from_client_invoice(
    p_tenant_id,
    v_invoice
  );

  RETURN v_invoice;
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_client_invoice_payment(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_payment_method text,
  p_notes text,
  p_recorded_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.client_invoices;
  v_amount numeric;
  v_already_paid numeric;
  v_remaining numeric;
  v_payment_id uuid;
  v_receipt_number text;
  v_receipt_sequence integer;
  v_signature_name text;
  v_signature_title text;
  v_receipt public.client_receipts;
  v_updated public.client_invoices;
  v_bu uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'invoice_id is required';
  END IF;

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'payment_date is required';
  END IF;

  v_amount := public._cip_round_money(p_amount);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  SELECT *
  INTO v_invoice
  FROM public.client_invoices ci
  WHERE ci.id = p_invoice_id
    AND ci.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found.';
  END IF;

  IF v_invoice.status = 'draft' THEN
    RAISE EXCEPTION 'Cannot record payment against a draft invoice. Mark it as sent first.';
  END IF;

  IF v_invoice.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot record payment against a voided invoice.';
  END IF;

  v_already_paid := public._cip_sum_client_invoice_payments(p_tenant_id, p_invoice_id);
  v_remaining := public._cip_cash_outstanding(
    v_invoice.total_amount_due,
    v_invoice.wht_amount,
    v_already_paid
  );

  IF v_amount > v_remaining + 0.009 THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance (%).', v_remaining;
  END IF;

  v_bu := v_invoice.business_unit_id;

  INSERT INTO public.client_invoice_payments (
    tenant_id,
    invoice_id,
    payment_date,
    amount,
    payment_method,
    notes,
    recorded_by,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_invoice_id,
    p_payment_date,
    v_amount,
    public._cip_nullable_text(p_payment_method),
    public._cip_nullable_text(p_notes),
    p_recorded_by,
    v_bu
  )
  RETURNING id INTO v_payment_id;

  v_receipt_number := public.generate_next_code(p_tenant_id, 'RCPT', 4);
  IF v_receipt_number IS NULL OR btrim(v_receipt_number) = '' THEN
    RAISE EXCEPTION 'generate_next_code returned an empty receipt number.';
  END IF;

  SELECT coalesce(max(receipt_sequence), 0) + 1
  INTO v_receipt_sequence
  FROM public.client_receipts
  WHERE tenant_id = p_tenant_id;

  SELECT
    public._cip_nullable_text(signature_author_name),
    public._cip_nullable_text(signature_author_title)
  INTO v_signature_name, v_signature_title
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found.';
  END IF;

  INSERT INTO public.client_receipts (
    tenant_id,
    invoice_id,
    payment_id,
    receipt_number,
    receipt_sequence,
    receipt_date,
    amount,
    payment_method,
    notes,
    authorized_by_name,
    authorized_by_title,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_invoice_id,
    v_payment_id,
    v_receipt_number,
    v_receipt_sequence,
    p_payment_date,
    v_amount,
    public._cip_nullable_text(p_payment_method),
    public._cip_nullable_text(p_notes),
    v_signature_name,
    v_signature_title,
    v_bu
  )
  RETURNING * INTO v_receipt;

  v_updated := public._cip_recompute_client_invoice_from_payments(
    p_tenant_id,
    p_invoice_id
  );

  RETURN jsonb_build_object(
    'payment', jsonb_build_object('id', v_payment_id),
    'receipt', to_jsonb(v_receipt),
    'invoice', to_jsonb(v_updated)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_client_invoice_payment(
  p_tenant_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.client_invoice_payments;
  v_voided_receipt_number text;
  v_updated public.client_invoices;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'payment_id is required';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.client_invoice_payments p
  WHERE p.id = p_payment_id
    AND p.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found.';
  END IF;

  SELECT receipt_number
  INTO v_voided_receipt_number
  FROM public.client_receipts
  WHERE payment_id = v_payment.id
    AND tenant_id = p_tenant_id;

  DELETE FROM public.client_invoice_payments
  WHERE id = v_payment.id
    AND tenant_id = p_tenant_id;

  v_updated := public._cip_recompute_client_invoice_from_payments(
    p_tenant_id,
    v_payment.invoice_id
  );

  RETURN jsonb_build_object(
    'invoice', to_jsonb(v_updated),
    'voided_receipt_number', v_voided_receipt_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_client_invoice_payment(uuid, uuid, date, numeric, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_client_invoice_payment(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_client_invoice_payment(uuid, uuid, date, numeric, text, text, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.void_client_invoice_payment(uuid, uuid)
  TO service_role;

COMMIT;
