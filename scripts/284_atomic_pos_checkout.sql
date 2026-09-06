-- Atomic multi-line POS checkout (cash + MoMo fulfillment).
-- Mirrors sync_offline_pos_cash_sale clean path + syncProductSaleVfrsTax in one transaction.

BEGIN;

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._pos_round_money(p_value numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(coalesce(p_value, 0)::numeric, 2);
$$;

CREATE OR REPLACE FUNCTION public._pos_build_notes(
  p_payment_method text,
  p_user_notes text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p_user_notes, '')), '') IS NULL THEN
      'Payment method: ' || btrim(coalesce(p_payment_method, ''))
    ELSE
      'Payment method: ' || btrim(coalesce(p_payment_method, ''))
        || E'\n' || btrim(p_user_notes)
  END;
$$;

CREATE OR REPLACE FUNCTION public._pos_pick_tax_settings(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS public.tax_settings
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row public.tax_settings;
BEGIN
  IF p_business_unit_id IS NOT NULL THEN
    SELECT *
    INTO v_row
    FROM public.tax_settings ts
    WHERE ts.tenant_id = p_tenant_id
      AND ts.business_unit_id = p_business_unit_id
    LIMIT 1;

    IF FOUND THEN
      RETURN v_row;
    END IF;
  END IF;

  SELECT *
  INTO v_row
  FROM public.tax_settings ts
  WHERE ts.tenant_id = p_tenant_id
    AND ts.business_unit_id IS NULL
  LIMIT 1;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_product_sale_tax_rate(p_settings public.tax_settings)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_settings IS NULL THEN 0::numeric
    WHEN coalesce(p_settings.product_sales_tax_rate, 0)::numeric = 3 THEN 3::numeric
    ELSE 0::numeric
  END;
$$;

CREATE OR REPLACE FUNCTION public._pos_compute_vfrs_output_tax(
  p_amount numeric,
  p_settings public.tax_settings
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_amount numeric := public._pos_round_money(p_amount);
  v_rate numeric;
  v_output_vat numeric;
BEGIN
  IF p_settings IS NULL OR p_settings.vat_registered IS FALSE THEN
    RETURN jsonb_build_object(
      'component', NULL,
      'rate_pct', 0,
      'output_vat_amount', 0,
      'net_of_tax_amount', v_amount
    );
  END IF;

  v_rate := public._pos_product_sale_tax_rate(p_settings);
  IF v_rate <= 0 THEN
    RETURN jsonb_build_object(
      'component', NULL,
      'rate_pct', 0,
      'output_vat_amount', 0,
      'net_of_tax_amount', v_amount
    );
  END IF;

  v_output_vat := public._pos_round_money((v_amount * v_rate) / (100 + v_rate));

  RETURN jsonb_build_object(
    'component', 'vfrs',
    'rate_pct', v_rate,
    'output_vat_amount', v_output_vat,
    'net_of_tax_amount', public._pos_round_money(v_amount - v_output_vat)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_sync_vfrs_for_income_id(
  p_tenant_id uuid,
  p_income_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.income_register;
  v_settings public.tax_settings;
  v_tax jsonb;
  v_tax_rows jsonb;
  v_counterparty text;
BEGIN
  SELECT *
  INTO v_row
  FROM public.income_register i
  WHERE i.id = p_income_id
    AND i.tenant_id = p_tenant_id
    AND i.entry_type = 'product_sale';

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_settings := public._pos_pick_tax_settings(p_tenant_id, v_row.business_unit_id);
  v_tax := public._pos_compute_vfrs_output_tax(v_row.amount, v_settings);

  UPDATE public.income_register i
  SET
    tax_inclusive = true,
    net_of_tax_amount = (v_tax->>'net_of_tax_amount')::numeric,
    output_tax_component = nullif(v_tax->>'component', '')::text,
    output_vat_amount = (v_tax->>'output_vat_amount')::numeric
  WHERE i.id = p_income_id
    AND i.tenant_id = p_tenant_id;

  IF coalesce((v_tax->>'output_vat_amount')::numeric, 0) <= 0 THEN
    PERFORM public.replace_income_register_tax_ledger_entries(p_income_id::text, '[]'::jsonb);
    RETURN;
  END IF;

  SELECT coalesce(c.client_name, nullif(btrim(v_row.customer_name), ''))
  INTO v_counterparty
  FROM public.income_register i
  LEFT JOIN public.customers c
    ON c.client_id = i.client_id
   AND c.tenant_id = i.tenant_id
  WHERE i.id = p_income_id;

  v_tax_rows := public._cip_build_income_tax_ledger_rows(
    p_tenant_id,
    p_income_id,
    v_row.date,
    public._pos_round_money(v_row.amount),
    NULL,
    0,
    'vfrs',
    (v_tax->>'rate_pct')::numeric,
    (v_tax->>'output_vat_amount')::numeric,
    v_counterparty,
    CASE
      WHEN nullif(btrim(v_row.invoice_no), '') IS NOT NULL
        THEN 'Product sale ' || btrim(v_row.invoice_no)
      ELSE NULL
    END
  );

  PERFORM public.replace_income_register_tax_ledger_entries(
    p_income_id::text,
    v_tax_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_sync_vfrs_for_income_ids(
  p_tenant_id uuid,
  p_income_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_income_id uuid;
BEGIN
  IF p_income_ids IS NULL OR cardinality(p_income_ids) = 0 THEN
    RETURN;
  END IF;

  FOREACH v_income_id IN ARRAY p_income_ids
  LOOP
    PERFORM public._pos_sync_vfrs_for_income_id(p_tenant_id, v_income_id);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPC: checkout_pos_cart
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.checkout_pos_cart(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_sale_date date,
  p_invoice_no text,
  p_client_id text,
  p_customer_name text,
  p_payment_status text,
  p_due_date date,
  p_notes text,
  p_payment_method text,
  p_sales_rep_id text,
  p_amount_received numeric,
  p_lines jsonb,
  p_payment_request_id uuid DEFAULT NULL,
  p_paid_amount numeric DEFAULT NULL,
  p_paystack_reference text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_invoice_no text := nullif(btrim(coalesce(p_invoice_no, '')), '');
  v_pos_notes text;
  v_remaining numeric;
  v_line_total numeric;
  v_line_recv numeric;
  v_income_id uuid;
  v_income_ids uuid[] := ARRAY[]::uuid[];
  v_client_id text := nullif(btrim(coalesce(p_client_id, '')), '');
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_payment_status text := btrim(coalesce(p_payment_status, ''));
  v_payment_method text := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), 'Cash');
  v_sales_rep_id text := nullif(btrim(coalesce(p_sales_rep_id, '')), '');
  v_i integer;
  v_line_num integer;
  v_line_count integer;
  v_product_code text;
  v_product_name text;
  v_request public.product_sale_payment_requests;
  v_cart_total numeric := 0;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  IF p_sale_date IS NULL THEN
    RAISE EXCEPTION 'sale_date is required';
  END IF;

  IF p_lines IS NULL
    OR jsonb_typeof(p_lines) <> 'array'
    OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'lines must be a non-empty JSON array';
  END IF;

  IF v_payment_status = '' THEN
    RAISE EXCEPTION 'payment_status is required';
  END IF;

  PERFORM public.assert_not_view_all_business_units();

  v_pos_notes := public._pos_build_notes(v_payment_method, p_notes);
  v_remaining := public._pos_round_money(coalesce(p_amount_received, 0));

  IF p_payment_request_id IS NOT NULL THEN
    SELECT *
    INTO v_request
    FROM public.product_sale_payment_requests pr
    WHERE pr.id = p_payment_request_id
      AND pr.tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment request not found.';
    END IF;

    IF v_request.status = 'paid' THEN
      RETURN jsonb_build_object(
        'invoice_no', v_request.invoice_no,
        'income_ids', to_jsonb(coalesce(v_request.income_ids, ARRAY[]::uuid[])),
        'already_fulfilled', true
      );
    END IF;

    IF cardinality(coalesce(v_request.income_ids, ARRAY[]::uuid[])) > 0 THEN
      RETURN jsonb_build_object(
        'invoice_no', v_request.invoice_no,
        'income_ids', to_jsonb(v_request.income_ids),
        'already_fulfilled', true
      );
    END IF;
  END IF;

  IF v_invoice_no IS NULL THEN
    v_invoice_no := public.generate_next_code(p_tenant_id, 'POS', 4);
  END IF;

  v_line_count := jsonb_array_length(p_lines);

  FOR v_i IN 0 .. v_line_count - 1
  LOOP
    v_line := p_lines->v_i;
    v_line_num := v_i + 1;

    v_product_code := nullif(btrim(coalesce(v_line->>'product_code', '')), '');
    v_product_name := nullif(btrim(coalesce(v_line->>'product_name', '')), '');

    IF v_product_code IS NULL OR v_product_name IS NULL THEN
      SELECT fp.product_code, fp.product_name
      INTO v_product_code, v_product_name
      FROM public.finished_products fp
      WHERE fp.id = (v_line->>'product_id')::uuid;
    END IF;

    v_line_total := public._pos_round_money(
      coalesce((v_line->>'quantity')::numeric, 0)
      * coalesce((v_line->>'unit_price')::numeric, 0)
    );
    v_cart_total := v_cart_total + v_line_total;

    IF p_payment_request_id IS NOT NULL THEN
      v_line_recv := v_line_total;
    ELSE
      v_line_recv := public._pos_round_money(
        least(v_line_total, greatest(v_remaining, 0))
      );
      v_remaining := public._pos_round_money(v_remaining - v_line_recv);
    END IF;

    BEGIN
      v_income_id := public.create_product_sale(
        p_sale_date,
        v_invoice_no,
        v_client_id,
        CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
        (v_line->>'product_id')::uuid,
        (v_line->>'quantity')::numeric,
        (v_line->>'unit_price')::numeric,
        v_line_recv,
        v_payment_status,
        p_due_date,
        NULL,
        v_pos_notes,
        'POS',
        v_sales_rep_id,
        p_business_unit_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Checkout failed on line % of % (% — %): %',
          v_line_num,
          v_line_count,
          coalesce(v_product_code, '?'),
          coalesce(v_product_name, 'Unknown product'),
          SQLERRM;
    END;

    v_income_ids := array_append(v_income_ids, v_income_id);
  END LOOP;

  PERFORM public._pos_sync_vfrs_for_income_ids(p_tenant_id, v_income_ids);

  IF p_payment_request_id IS NOT NULL THEN
    UPDATE public.product_sale_payment_requests pr
    SET
      status = 'paid',
      invoice_no = v_invoice_no,
      income_ids = v_income_ids,
      paid_amount = public._pos_round_money(
        coalesce(p_paid_amount, v_cart_total)
      ),
      paid_at = coalesce(p_paid_at, now()),
      paystack_reference = coalesce(
        nullif(btrim(coalesce(p_paystack_reference, '')), ''),
        pr.paystack_reference
      ),
      payment_method = v_payment_method,
      updated_at = now()
    WHERE pr.id = p_payment_request_id
      AND pr.tenant_id = p_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'invoice_no', v_invoice_no,
    'income_ids', to_jsonb(v_income_ids),
    'already_fulfilled', false
  );
END;
$$;

COMMENT ON FUNCTION public.checkout_pos_cart(
  uuid, uuid, date, text, text, text, text, date, text, text, text, numeric, jsonb,
  uuid, numeric, text, timestamptz
) IS
  'Atomically checkout a POS cart: create_product_sale per line, VFRS tax sync, optional MoMo payment_request update.';

REVOKE ALL ON FUNCTION public.checkout_pos_cart(
  uuid, uuid, date, text, text, text, text, date, text, text, text, numeric, jsonb,
  uuid, numeric, text, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.checkout_pos_cart(
  uuid, uuid, date, text, text, text, text, date, text, text, text, numeric, jsonb,
  uuid, numeric, text, timestamptz
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
