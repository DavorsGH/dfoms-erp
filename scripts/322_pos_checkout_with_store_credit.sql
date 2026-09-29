BEGIN;

CREATE OR REPLACE FUNCTION public._pos_cart_gross_total(p_lines jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_i integer;
  v_line jsonb;
  v_total numeric := 0;
BEGIN
  IF p_lines IS NULL
    OR jsonb_typeof(p_lines) <> 'array'
    OR jsonb_array_length(p_lines) = 0 THEN
    RETURN 0;
  END IF;

  FOR v_i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_line := p_lines->v_i;
    v_total := v_total + public._pos_round_money(
      coalesce((v_line->>'quantity')::numeric, 0)
      * coalesce((v_line->>'unit_price')::numeric, 0)
    );
  END LOOP;

  RETURN public._pos_round_money(v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_validate_credit_note_for_checkout(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_credit_note_id uuid,
  p_client_id text,
  p_apply_amount numeric
)
RETURNS public.credit_notes
LANGUAGE plpgsql
AS $$
DECLARE
  v_note public.credit_notes;
  v_available numeric(18, 4);
  v_client text := nullif(btrim(coalesce(p_client_id, '')), '');
BEGIN
  IF p_credit_note_id IS NULL THEN
    RAISE EXCEPTION 'Credit note is required';
  END IF;

  IF p_apply_amount IS NULL OR p_apply_amount <= 0 THEN
    RAISE EXCEPTION 'Credit apply amount must be greater than zero';
  END IF;

  SELECT *
  INTO v_note
  FROM public.credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  IF v_note.business_unit_id IS DISTINCT FROM p_business_unit_id THEN
    RAISE EXCEPTION 'Credit note business unit does not match this sale';
  END IF;

  IF v_note.return_mode IS NOT NULL
    AND v_note.return_mode NOT IN ('store_credit', 'exchange_hold') THEN
    RAISE EXCEPTION 'Credit note cannot be applied at checkout';
  END IF;

  IF coalesce(v_note.status, '') = 'voided' THEN
    RAISE EXCEPTION 'Credit note is voided';
  END IF;

  v_available := public._pos_round_money(
    coalesce(v_note.total_amount, 0)
    - coalesce(v_note.refunded_amount, 0)
    - coalesce(v_note.applied_amount, 0)
  );

  IF v_available <= 0.0001 THEN
    RAISE EXCEPTION 'Credit note has no available balance';
  END IF;

  IF p_apply_amount > v_available + 0.0001 THEN
    RAISE EXCEPTION 'Credit apply amount % exceeds available balance %',
      p_apply_amount, v_available;
  END IF;

  IF v_note.client_id IS NOT NULL
    AND nullif(btrim(v_note.client_id), '') IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'Credit note belongs to a different customer';
  END IF;

  RETURN v_note;
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_build_credit_applications_for_checkout(
  p_income_ids uuid[],
  p_lines jsonb,
  p_credit_total numeric
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_i integer;
  v_line jsonb;
  v_line_total numeric(18, 4);
  v_line_cash numeric(18, 4);
  v_line_credit numeric(18, 4);
  v_remaining_credit numeric(18, 4);
  v_income_id uuid;
  v_apps jsonb := '[]'::jsonb;
  v_line_count integer;
BEGIN
  v_remaining_credit := public._pos_round_money(coalesce(p_credit_total, 0));
  IF v_remaining_credit <= 0 THEN
    RETURN v_apps;
  END IF;

  v_line_count := coalesce(array_length(p_income_ids, 1), 0);
  IF v_line_count = 0 THEN
    RETURN v_apps;
  END IF;

  FOR v_i IN 1 .. v_line_count LOOP
    EXIT WHEN v_remaining_credit <= 0.0001;

    v_line := p_lines->(v_i - 1);
    v_income_id := p_income_ids[v_i];

    v_line_total := public._pos_round_money(
      coalesce((v_line->>'quantity')::numeric, 0)
      * coalesce((v_line->>'unit_price')::numeric, 0)
    );

    SELECT public._pos_round_money(coalesce(ir.amount_received, 0))
    INTO v_line_cash
    FROM public.income_register ir
    WHERE ir.id = v_income_id;

    v_line_credit := public._pos_round_money(
      least(
        v_remaining_credit,
        greatest(v_line_total - v_line_cash, 0)
      )
    );

    IF v_line_credit > 0.0001 THEN
      v_apps := v_apps || jsonb_build_array(
        jsonb_build_object(
          'income_register_id', v_income_id,
          'amount', v_line_credit
        )
      );
      v_remaining_credit := public._pos_round_money(v_remaining_credit - v_line_credit);
    END IF;
  END LOOP;

  IF v_remaining_credit > 0.0001 THEN
    RAISE EXCEPTION 'Could not allocate store credit across sale lines; remaining %', v_remaining_credit;
  END IF;

  RETURN v_apps;
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_finalize_income_after_store_credit(
  p_income_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOREACH v_id IN ARRAY coalesce(p_income_ids, ARRAY[]::uuid[]) LOOP
    UPDATE public.income_register ir
    SET
      outstanding_balance = public._pos_round_money(
        greatest(
          coalesce(ir.amount, 0) - coalesce(ir.amount_received, 0),
          0
        )
      ),
      payment_status = CASE
        WHEN coalesce(ir.amount, 0) - coalesce(ir.amount_received, 0) <= 0.0001 THEN 'Paid'
        ELSE 'Partial'
      END
    WHERE ir.id = v_id;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_checkout_with_store_credit(
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
  p_paid_at timestamptz DEFAULT NULL,
  p_credit_note_id uuid DEFAULT NULL,
  p_credit_apply_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cart_total numeric(18, 4);
  v_cash_tender numeric(18, 4);
  v_cash_needed numeric(18, 4);
  v_cash_recorded numeric(18, 4);
  v_change_due numeric(18, 4);
  v_credit_apply numeric(18, 4);
  v_checkout jsonb;
  v_income_ids uuid[];
  v_applications jsonb;
  v_apply_result jsonb;
  v_method text := lower(btrim(coalesce(p_payment_method, '')));
  v_income_payment_method text;
  v_note public.credit_notes;
  v_available numeric(18, 4);
  v_client text := nullif(btrim(coalesce(p_client_id, '')), '');
  v_credit_remaining numeric(18, 4);
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required.';
  END IF;

  PERFORM public.assert_not_view_all_business_units();

  IF public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Tenant mismatch';
  END IF;

  v_cart_total := public._pos_cart_gross_total(p_lines);
  v_cash_tender := public._pos_round_money(coalesce(p_amount_received, 0));

  IF p_credit_note_id IS NULL OR coalesce(p_credit_apply_amount, 0) <= 0 THEN
    RETURN public.checkout_pos_cart(
      p_tenant_id,
      p_business_unit_id,
      p_sale_date,
      p_invoice_no,
      p_client_id,
      p_customer_name,
      p_payment_status,
      p_due_date,
      p_notes,
      p_payment_method,
      p_sales_rep_id,
      p_amount_received,
      p_lines,
      p_payment_request_id,
      p_paid_amount,
      p_paystack_reference,
      p_paid_at
    );
  END IF;

  IF p_payment_request_id IS NOT NULL
    OR v_method LIKE '%mobile money%'
    OR v_method LIKE '%momo%'
    OR v_method LIKE '%paystack%' THEN
    RAISE EXCEPTION 'Store credit cannot be combined with Mobile Money checkout yet. Use Cash or Bank transfer for the remainder, or pay the full balance with Mobile Money without store credit.';
  END IF;

  v_credit_apply := public._pos_round_money(
    least(
      coalesce(p_credit_apply_amount, 0),
      v_cart_total
    )
  );

  IF v_credit_apply <= 0 THEN
    RAISE EXCEPTION 'Credit apply amount must be greater than zero';
  END IF;

  SELECT *
  INTO v_note
  FROM public.credit_notes cn
  WHERE cn.id = p_credit_note_id
    AND cn.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  IF v_note.business_unit_id IS DISTINCT FROM p_business_unit_id THEN
    RAISE EXCEPTION 'Credit note business unit does not match this sale';
  END IF;

  IF v_note.return_mode IS NOT NULL
    AND v_note.return_mode NOT IN ('store_credit', 'exchange_hold') THEN
    RAISE EXCEPTION 'Credit note cannot be applied at checkout';
  END IF;

  IF coalesce(v_note.status, '') = 'voided' THEN
    RAISE EXCEPTION 'Credit note is voided';
  END IF;

  v_available := public._pos_round_money(
    coalesce(v_note.total_amount, 0)
    - coalesce(v_note.refunded_amount, 0)
    - coalesce(v_note.applied_amount, 0)
  );

  IF v_available <= 0.0001 THEN
    RAISE EXCEPTION 'Credit note has no available balance';
  END IF;

  IF v_credit_apply > v_available + 0.0001 THEN
    RAISE EXCEPTION 'Credit apply amount % exceeds available balance %',
      v_credit_apply, v_available;
  END IF;

  IF v_note.client_id IS NOT NULL
    AND nullif(btrim(v_note.client_id), '') IS DISTINCT FROM v_client THEN
    RAISE EXCEPTION 'Credit note belongs to a different customer';
  END IF;

  v_cash_needed := public._pos_round_money(v_cart_total - v_credit_apply);
  v_cash_recorded := public._pos_round_money(
    least(v_cash_tender, greatest(v_cash_needed, 0))
  );
  v_change_due := public._pos_round_money(
    greatest(v_cash_tender - v_cash_recorded, 0)
  );

  IF v_cash_recorded + v_credit_apply + 0.0001 < v_cart_total THEN
    RAISE EXCEPTION 'Cash % plus store credit % is less than cart total %',
      v_cash_recorded, v_credit_apply, v_cart_total;
  END IF;

  IF v_cash_recorded <= 0.0001 THEN
    v_income_payment_method := 'Store credit';
  ELSE
    v_income_payment_method := btrim(coalesce(p_payment_method, 'Cash')) || ' + Store credit';
  END IF;

  v_checkout := public.checkout_pos_cart(
    p_tenant_id,
    p_business_unit_id,
    p_sale_date,
    p_invoice_no,
    p_client_id,
    p_customer_name,
    'Partial',
    p_due_date,
    p_notes,
    v_income_payment_method,
    p_sales_rep_id,
    v_cash_recorded,
    p_lines,
    NULL,
    NULL,
    NULL,
    NULL
  );

  v_income_ids := ARRAY(
    SELECT jsonb_array_elements_text(coalesce(v_checkout->'income_ids', '[]'::jsonb))::uuid
  );

  v_applications := public._pos_build_credit_applications_for_checkout(
    v_income_ids,
    p_lines,
    v_credit_apply
  );

  IF jsonb_array_length(v_applications) = 0 THEN
    RAISE EXCEPTION 'Store credit allocation produced no applications';
  END IF;

  v_apply_result := public.apply_credit_note_to_income(
    p_tenant_id,
    p_credit_note_id,
    v_applications,
    coalesce(p_sale_date, CURRENT_DATE)
  );

  PERFORM public._pos_finalize_income_after_store_credit(v_income_ids);

  SELECT public._pos_round_money(
    coalesce(cn.total_amount, 0)
    - coalesce(cn.refunded_amount, 0)
    - coalesce(cn.applied_amount, 0)
  )
  INTO v_credit_remaining
  FROM public.credit_notes cn
  WHERE cn.id = p_credit_note_id;

  RETURN v_checkout || jsonb_build_object(
    'credit_applied', v_credit_apply,
    'cash_tendered', v_cash_tender,
    'cash_recorded', v_cash_recorded,
    'change_due', v_change_due,
    'credit_note_id', p_credit_note_id,
    'credit_note_number', v_note.credit_note_number,
    'credit_remaining_balance', v_credit_remaining,
    'credit_application', v_apply_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public._pos_cart_gross_total(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pos_validate_credit_note_for_checkout(uuid, uuid, uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pos_build_credit_applications_for_checkout(uuid[], jsonb, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pos_finalize_income_after_store_credit(uuid[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._pos_cart_gross_total(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pos_validate_credit_note_for_checkout(uuid, uuid, uuid, text, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pos_build_credit_applications_for_checkout(uuid[], jsonb, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pos_finalize_income_after_store_credit(uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pos_checkout_with_store_credit(
  uuid, uuid, date, text, text, text, text, date, text, text, text, numeric, jsonb,
  uuid, numeric, text, timestamptz, uuid, numeric
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.pos_checkout_with_store_credit(
  uuid, uuid, date, text, text, text, text, date, text, text, text, numeric, jsonb,
  uuid, numeric, text, timestamptz, uuid, numeric
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
