-- Atomic client invoice save / status change / void (single-transaction RPCs).
-- Reuses _cip_* helpers from scripts/280_atomic_client_invoice_payment.sql.
-- Mirrors utils/client-invoices-api.ts create/update/status/void flows.

BEGIN;

-- ---------------------------------------------------------------------------
-- Private helpers (invoice save)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._ci_line_total_cost(
  p_labour numeric,
  p_material numeric,
  p_discount numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT public._cip_round_money(
    coalesce(p_labour, 0) + coalesce(p_material, 0) - coalesce(p_discount, 0)
  );
$$;

CREATE OR REPLACE FUNCTION public._ci_is_line_taxed(p_taxed boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_taxed, true);
$$;

CREATE OR REPLACE FUNCTION public._ci_load_sales_tax_basis(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_basis text;
BEGIN
  IF p_business_unit_id IS NOT NULL THEN
    SELECT ts.sales_tax_basis
    INTO v_basis
    FROM public.tax_settings ts
    WHERE ts.tenant_id = p_tenant_id
      AND ts.business_unit_id = p_business_unit_id
    LIMIT 1;

    IF v_basis IS NOT NULL THEN
      RETURN CASE
        WHEN btrim(v_basis) = 'total_cost' THEN 'total_cost'
        ELSE 'service_only'
      END;
    END IF;
  END IF;

  SELECT ts.sales_tax_basis
  INTO v_basis
  FROM public.tax_settings ts
  WHERE ts.tenant_id = p_tenant_id
    AND ts.business_unit_id IS NULL
  LIMIT 1;

  RETURN CASE
    WHEN btrim(coalesce(v_basis, '')) = 'total_cost' THEN 'total_cost'
    ELSE 'service_only'
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._ci_compute_invoice_totals(
  p_line_items jsonb,
  p_vat_rate numeric,
  p_wht_rate numeric,
  p_tax_basis text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_line jsonb;
  v_subtotal numeric := 0;
  v_taxed_line_subtotal numeric := 0;
  v_taxed_labour_total numeric := 0;
  v_line_total numeric;
  v_labour numeric;
  v_tax_base numeric;
  v_vat numeric;
  v_wht numeric;
BEGIN
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' THEN
    RAISE EXCEPTION 'line_items must be a JSON array';
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_line_items)
  LOOP
    v_labour := coalesce((v_line->>'labour_amount')::numeric, 0);
    v_line_total := public._ci_line_total_cost(
      v_labour,
      (v_line->>'material_amount')::numeric,
      (v_line->>'discount_amount')::numeric
    );
    v_subtotal := v_subtotal + v_line_total;

    IF public._ci_is_line_taxed((v_line->>'taxed')::boolean) THEN
      v_taxed_line_subtotal := v_taxed_line_subtotal + v_line_total;
      v_taxed_labour_total := v_taxed_labour_total + v_labour;
    END IF;
  END LOOP;

  v_subtotal := public._cip_round_money(v_subtotal);
  v_taxed_line_subtotal := public._cip_round_money(v_taxed_line_subtotal);
  v_taxed_labour_total := public._cip_round_money(v_taxed_labour_total);

  v_tax_base := CASE
    WHEN p_tax_basis = 'total_cost' THEN v_taxed_line_subtotal
    ELSE v_taxed_labour_total
  END;

  v_vat := public._cip_round_money(v_tax_base * coalesce(p_vat_rate, 0) / 100);
  v_wht := public._cip_round_money(v_tax_base * coalesce(p_wht_rate, 0) / 100);

  RETURN jsonb_build_object(
    'subtotal', v_subtotal,
    'tax_due', v_vat,
    'wht_amount', v_wht,
    'total_amount_due', public._cip_round_money(v_subtotal + v_vat)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._ci_next_invoice_sequence(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(max(invoice_sequence), 0) + 1
  FROM public.client_invoices
  WHERE tenant_id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION public._ci_replace_line_items(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_line_items jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_line jsonb;
  v_idx integer := 0;
BEGIN
  DELETE FROM public.client_invoice_line_items
  WHERE invoice_id = p_invoice_id
    AND tenant_id = p_tenant_id;

  IF p_line_items IS NULL OR jsonb_array_length(p_line_items) = 0 THEN
    RETURN;
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO public.client_invoice_line_items (
      invoice_id,
      tenant_id,
      site_id,
      category_label,
      description,
      labour_amount,
      material_amount,
      discount_amount,
      taxed,
      total_cost,
      sort_order
    )
    VALUES (
      p_invoice_id,
      p_tenant_id,
      public._cip_nullable_text(v_line->>'site_id'),
      public._cip_nullable_text(v_line->>'category_label'),
      btrim(coalesce(v_line->>'description', '')),
      public._cip_round_money((v_line->>'labour_amount')::numeric),
      public._cip_round_money((v_line->>'material_amount')::numeric),
      public._cip_round_money((v_line->>'discount_amount')::numeric),
      public._ci_is_line_taxed((v_line->>'taxed')::boolean),
      public._ci_line_total_cost(
        (v_line->>'labour_amount')::numeric,
        (v_line->>'material_amount')::numeric,
        (v_line->>'discount_amount')::numeric
      ),
      coalesce((v_line->>'sort_order')::integer, v_idx)
    );
    v_idx := v_idx + 1;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._ci_replace_payment_accounts(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_payment_account_ids jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  DELETE FROM public.client_invoice_payment_accounts
  WHERE invoice_id = p_invoice_id
    AND tenant_id = p_tenant_id;

  IF p_payment_account_ids IS NULL
    OR jsonb_typeof(p_payment_account_ids) <> 'array'
    OR jsonb_array_length(p_payment_account_ids) = 0 THEN
    RETURN;
  END IF;

  FOR v_account_id IN
    SELECT DISTINCT (value #>> '{}')::uuid
    FROM jsonb_array_elements(p_payment_account_ids) AS t(value)
    WHERE nullif(btrim(value #>> '{}'), '') IS NOT NULL
  LOOP
    INSERT INTO public.client_invoice_payment_accounts (
      invoice_id,
      payment_account_id,
      tenant_id
    )
    VALUES (p_invoice_id, v_account_id, p_tenant_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._ci_status_transition_allowed(
  p_current_status text,
  p_next_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_current_status
    WHEN 'draft' THEN p_next_status = 'sent'
    WHEN 'sent' THEN p_next_status IN ('paid', 'voided')
    WHEN 'partial' THEN p_next_status = 'voided'
    WHEN 'paid' THEN p_next_status = 'voided'
    ELSE false
  END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC: save_client_invoice
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_client_invoice(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_business_unit_id uuid,
  p_payload jsonb,
  p_fixed_header_totals jsonb DEFAULT NULL,
  p_tax_basis_override text DEFAULT NULL,
  p_contract_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.client_invoices;
  v_line_items jsonb;
  v_payment_account_ids jsonb;
  v_vat_rate numeric;
  v_wht_rate numeric;
  v_tax_basis text;
  v_totals jsonb;
  v_invoice_number text;
  v_sequence integer;
  v_status text;
  v_amount_received numeric;
  v_payments_total numeric;
  v_contract_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  IF nullif(btrim(p_payload->>'client_id'), '') IS NULL THEN
    RAISE EXCEPTION 'Customer is required.';
  END IF;

  IF nullif(btrim(p_payload->>'invoice_date'), '') IS NULL THEN
    RAISE EXCEPTION 'Invoice date is required.';
  END IF;

  IF nullif(btrim(p_payload->>'bill_to_name'), '') IS NULL THEN
    RAISE EXCEPTION 'Bill to name is required.';
  END IF;

  v_line_items := coalesce(p_payload->'line_items', '[]'::jsonb);
  v_payment_account_ids := coalesce(p_payload->'payment_account_ids', '[]'::jsonb);
  v_vat_rate := public._cip_round_money((p_payload->>'vat_nhil_getfund_rate')::numeric);
  v_wht_rate := public._cip_round_money((p_payload->>'wht_rate')::numeric);

  v_tax_basis := CASE
    WHEN nullif(btrim(coalesce(p_tax_basis_override, '')), '') = 'total_cost' THEN 'total_cost'
    WHEN nullif(btrim(coalesce(p_tax_basis_override, '')), '') = 'service_only' THEN 'service_only'
    ELSE public._ci_load_sales_tax_basis(p_tenant_id, p_business_unit_id)
  END;

  IF p_fixed_header_totals IS NOT NULL
    AND jsonb_typeof(p_fixed_header_totals) = 'object' THEN
    v_totals := jsonb_build_object(
      'subtotal', public._cip_round_money((p_fixed_header_totals->>'subtotal')::numeric),
      'tax_due', public._cip_round_money((p_fixed_header_totals->>'tax_due')::numeric),
      'wht_amount', public._cip_round_money((p_fixed_header_totals->>'wht_amount')::numeric),
      'total_amount_due', public._cip_round_money((p_fixed_header_totals->>'total_amount_due')::numeric)
    );
  ELSE
    v_totals := public._ci_compute_invoice_totals(
      v_line_items,
      v_vat_rate,
      v_wht_rate,
      v_tax_basis
    );
  END IF;

  v_contract_id := coalesce(
    p_contract_id,
    nullif(btrim(coalesce(p_payload->>'contract_id', '')), '')::uuid
  );

  IF p_invoice_id IS NULL THEN
    v_invoice_number := public.generate_next_code(p_tenant_id, 'INV', 4);
    v_sequence := public._ci_next_invoice_sequence(p_tenant_id);
    v_status := 'draft';
    v_amount_received := 0;

    INSERT INTO public.client_invoices (
      tenant_id,
      client_id,
      contract_id,
      business_unit_id,
      invoice_number,
      invoice_sequence,
      invoice_date,
      due_date,
      billing_period_start,
      billing_period_end,
      bill_to_name,
      bill_to_address,
      bill_to_phone,
      subtotal,
      vat_nhil_getfund_rate,
      tax_due,
      wht_rate,
      wht_amount,
      total_amount_due,
      amount_received,
      status,
      notes,
      authorized_by_name,
      authorized_by_title,
      updated_at
    )
    VALUES (
      p_tenant_id,
      btrim(p_payload->>'client_id'),
      v_contract_id,
      p_business_unit_id,
      v_invoice_number,
      v_sequence,
      (p_payload->>'invoice_date')::date,
      public._cip_nullable_text(p_payload->>'due_date')::date,
      public._cip_nullable_text(p_payload->>'billing_period_start')::date,
      public._cip_nullable_text(p_payload->>'billing_period_end')::date,
      btrim(p_payload->>'bill_to_name'),
      public._cip_nullable_text(p_payload->>'bill_to_address'),
      public._cip_nullable_text(p_payload->>'bill_to_phone'),
      (v_totals->>'subtotal')::numeric,
      v_vat_rate,
      (v_totals->>'tax_due')::numeric,
      v_wht_rate,
      (v_totals->>'wht_amount')::numeric,
      (v_totals->>'total_amount_due')::numeric,
      v_amount_received,
      v_status,
      public._cip_nullable_text(p_payload->>'notes'),
      public._cip_nullable_text(p_payload->>'authorized_by_name'),
      public._cip_nullable_text(p_payload->>'authorized_by_title'),
      now()
    )
    RETURNING * INTO v_invoice;
  ELSE
    SELECT *
    INTO v_invoice
    FROM public.client_invoices ci
    WHERE ci.id = p_invoice_id
      AND ci.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found.';
    END IF;

    IF v_invoice.status = 'voided' THEN
      RAISE EXCEPTION 'Voided invoices cannot be edited.';
    END IF;

    v_payments_total := public._cip_sum_client_invoice_payments(p_tenant_id, p_invoice_id);

    IF v_payments_total > 0 THEN
      v_amount_received := v_payments_total;
      v_status := public._cip_derive_invoice_status_from_payments(
        v_payments_total,
        (v_totals->>'total_amount_due')::numeric,
        (v_totals->>'wht_amount')::numeric,
        coalesce(nullif(btrim(p_payload->>'status'), ''), v_invoice.status)
      );
    ELSE
      v_amount_received := public._cip_round_money((p_payload->>'amount_received')::numeric);
      v_status := coalesce(nullif(btrim(p_payload->>'status'), ''), v_invoice.status);
    END IF;

    UPDATE public.client_invoices ci
    SET
      client_id = btrim(p_payload->>'client_id'),
      contract_id = coalesce(v_contract_id, ci.contract_id),
      invoice_date = (p_payload->>'invoice_date')::date,
      due_date = public._cip_nullable_text(p_payload->>'due_date')::date,
      billing_period_start = public._cip_nullable_text(p_payload->>'billing_period_start')::date,
      billing_period_end = public._cip_nullable_text(p_payload->>'billing_period_end')::date,
      bill_to_name = btrim(p_payload->>'bill_to_name'),
      bill_to_address = public._cip_nullable_text(p_payload->>'bill_to_address'),
      bill_to_phone = public._cip_nullable_text(p_payload->>'bill_to_phone'),
      subtotal = (v_totals->>'subtotal')::numeric,
      vat_nhil_getfund_rate = v_vat_rate,
      tax_due = (v_totals->>'tax_due')::numeric,
      wht_rate = v_wht_rate,
      wht_amount = (v_totals->>'wht_amount')::numeric,
      total_amount_due = (v_totals->>'total_amount_due')::numeric,
      amount_received = v_amount_received,
      status = v_status,
      notes = public._cip_nullable_text(p_payload->>'notes'),
      authorized_by_name = public._cip_nullable_text(p_payload->>'authorized_by_name'),
      authorized_by_title = public._cip_nullable_text(p_payload->>'authorized_by_title'),
      updated_at = now()
    WHERE ci.id = p_invoice_id
      AND ci.tenant_id = p_tenant_id
    RETURNING * INTO v_invoice;
  END IF;

  PERFORM public._ci_replace_line_items(p_tenant_id, v_invoice.id, v_line_items);
  PERFORM public._ci_replace_payment_accounts(
    p_tenant_id,
    v_invoice.id,
    v_payment_account_ids
  );

  SELECT *
  INTO v_invoice
  FROM public.client_invoices ci
  WHERE ci.id = v_invoice.id
    AND ci.tenant_id = p_tenant_id;

  PERFORM public._cip_sync_income_register_from_client_invoice(p_tenant_id, v_invoice);

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice));
END;
$$;

COMMENT ON FUNCTION public.save_client_invoice(uuid, uuid, uuid, jsonb, jsonb, text, uuid) IS
  'Atomically save a client invoice (create or update): header, line items, payment-account links, income_register, and tax ledger.';

-- ---------------------------------------------------------------------------
-- Public RPC: change_client_invoice_status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.change_client_invoice_status(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.client_invoices;
  v_current_status text;
  v_next_status text := lower(btrim(coalesce(p_next_status, '')));
  v_total_due numeric;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Invoice id is required.';
  END IF;

  IF v_next_status NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'Invalid invoice status.';
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

  v_current_status := v_invoice.status;

  IF NOT public._ci_status_transition_allowed(v_current_status, v_next_status) THEN
    RAISE EXCEPTION 'Cannot change invoice status from % to %.', v_current_status, v_next_status;
  END IF;

  v_total_due := public._cip_round_money(v_invoice.total_amount_due);

  IF v_next_status = 'paid' THEN
    UPDATE public.client_invoices ci
    SET
      status = 'paid',
      amount_received = v_total_due,
      updated_at = now()
    WHERE ci.id = p_invoice_id
      AND ci.tenant_id = p_tenant_id
      AND ci.status = v_current_status
    RETURNING * INTO v_invoice;
  ELSE
    UPDATE public.client_invoices ci
    SET
      status = 'sent',
      updated_at = now()
    WHERE ci.id = p_invoice_id
      AND ci.tenant_id = p_tenant_id
      AND ci.status = v_current_status
    RETURNING * INTO v_invoice;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to update invoice status.';
  END IF;

  PERFORM public._cip_sync_income_register_from_client_invoice(p_tenant_id, v_invoice);

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice));
END;
$$;

COMMENT ON FUNCTION public.change_client_invoice_status(uuid, uuid, text) IS
  'Atomically change client invoice status (sent/paid) and sync income_register + tax ledger.';

-- ---------------------------------------------------------------------------
-- Public RPC: void_client_invoice
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_client_invoice(
  p_tenant_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.client_invoices;
  v_current_status text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Invoice id is required.';
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

  v_current_status := v_invoice.status;

  IF NOT public._ci_status_transition_allowed(v_current_status, 'voided') THEN
    IF v_current_status = 'draft' THEN
      RAISE EXCEPTION 'Draft invoices should be deleted, not voided.';
    ELSIF v_current_status = 'voided' THEN
      RAISE EXCEPTION 'This invoice is already voided.';
    ELSE
      RAISE EXCEPTION 'Cannot void an invoice with status %.', v_current_status;
    END IF;
  END IF;

  UPDATE public.client_invoices ci
  SET
    status = 'voided',
    updated_at = now()
  WHERE ci.id = p_invoice_id
    AND ci.tenant_id = p_tenant_id
    AND ci.status = v_current_status
  RETURNING * INTO v_invoice;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unable to void invoice.';
  END IF;

  PERFORM public._cip_sync_income_register_from_client_invoice(p_tenant_id, v_invoice);

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice));
END;
$$;

COMMENT ON FUNCTION public.void_client_invoice(uuid, uuid) IS
  'Atomically void a client invoice and sync income_register + tax ledger deletion.';

REVOKE ALL ON FUNCTION public.save_client_invoice(uuid, uuid, uuid, jsonb, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_client_invoice_status(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_client_invoice(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_client_invoice(uuid, uuid, uuid, jsonb, jsonb, text, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_client_invoice_status(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_client_invoice(uuid, uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
