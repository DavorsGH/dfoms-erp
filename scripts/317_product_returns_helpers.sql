BEGIN;

CREATE OR REPLACE FUNCTION public._return_prior_qty_for_sale_line(
  p_tenant_id uuid,
  p_income_register_id uuid,
  p_product_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(sum(li.quantity), 0)::numeric(18, 4)
  FROM public.credit_note_line_items li
  INNER JOIN public.credit_notes cn ON cn.id = li.credit_note_id
  WHERE cn.tenant_id = p_tenant_id
    AND li.source_income_register_id = p_income_register_id
    AND li.product_id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION public._sale_has_credit_notes(p_income_register_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.credit_notes cn
    WHERE cn.source_income_register_id = p_income_register_id
    UNION ALL
    SELECT 1
    FROM public.credit_note_line_items li
    WHERE li.source_income_register_id = p_income_register_id
  );
$$;

CREATE OR REPLACE FUNCTION public._sale_cogs_unit_cost(p_sale public.income_register)
RETURNS numeric
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_amount numeric(18, 4);
  v_price numeric(18, 4);
  v_qty numeric(18, 4);
BEGIN
  IF p_sale.cogs_expense_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT amount, price
  INTO v_amount, v_price
  FROM public.expense_register
  WHERE id = p_sale.cogs_expense_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_qty := coalesce(p_sale.sale_quantity, 0);
  IF v_qty > 0 AND v_amount IS NOT NULL THEN
    RETURN abs(v_amount) / v_qty;
  END IF;

  RETURN coalesce(abs(v_price), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_build_vfrs_return_tax_ledger_rows(
  p_tenant_id uuid,
  p_source_id uuid,
  p_entry_date date,
  p_gross_amount numeric,
  p_settings public.tax_settings,
  p_counterparty text,
  p_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_tax jsonb;
  v_gross numeric(18, 4);
  v_output_vat numeric(18, 4);
  v_net numeric(18, 4);
  v_rate numeric(18, 4);
  v_component text;
  v_period_month date;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  v_gross := public._pos_round_money(abs(p_gross_amount));
  IF v_gross <= 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  v_tax := public._pos_compute_vfrs_output_tax(v_gross, p_settings);
  v_output_vat := public._pos_round_money(coalesce((v_tax->>'output_vat_amount')::numeric, 0));
  v_net := public._pos_round_money(coalesce((v_tax->>'net_of_tax_amount')::numeric, v_gross));
  v_rate := coalesce((v_tax->>'rate_pct')::numeric, 0);
  v_component := nullif(v_tax->>'component', '');

  IF v_output_vat <= 0 OR v_component IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  v_period_month := public._cip_period_month(p_entry_date);

  v_rows := v_rows || jsonb_build_array(
    jsonb_build_object(
      'tenant_id', p_tenant_id,
      'entry_date', p_entry_date,
      'period_month', v_period_month,
      'direction', 'output',
      'tax_component', v_component,
      'rate_pct', v_rate,
      'taxable_base', -v_net,
      'tax_amount', -v_output_vat,
      'status', 'open',
      'counterparty_name', p_counterparty,
      'notes', p_notes
    )
  );

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public._pos_sync_vfrs_for_return_income_id(
  p_tenant_id uuid,
  p_return_income_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.income_register;
  v_settings public.tax_settings;
  v_gross numeric(18, 4);
  v_tax jsonb;
  v_counterparty text;
  v_tax_rows jsonb;
BEGIN
  SELECT *
  INTO v_row
  FROM public.income_register i
  WHERE i.id = p_return_income_id
    AND i.tenant_id = p_tenant_id
    AND i.is_sale_return IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return income row not found';
  END IF;

  v_gross := public._pos_round_money(abs(v_row.amount));
  v_settings := public._pos_pick_tax_settings(p_tenant_id, v_row.business_unit_id);
  v_tax := public._pos_compute_vfrs_output_tax(v_gross, v_settings);

  UPDATE public.income_register i
  SET
    tax_inclusive = true,
    net_of_tax_amount = -public._pos_round_money(coalesce((v_tax->>'net_of_tax_amount')::numeric, v_gross)),
    output_tax_component = nullif(v_tax->>'component', '')::text,
    output_vat_amount = -public._pos_round_money(coalesce((v_tax->>'output_vat_amount')::numeric, 0))
  WHERE i.id = p_return_income_id
    AND i.tenant_id = p_tenant_id;

  IF coalesce((v_tax->>'output_vat_amount')::numeric, 0) <= 0 THEN
    PERFORM public.replace_income_register_tax_ledger_entries(p_return_income_id::text, '[]'::jsonb);
    RETURN;
  END IF;

  SELECT coalesce(c.client_name, nullif(btrim(v_row.customer_name), ''))
  INTO v_counterparty
  FROM public.income_register i
  LEFT JOIN public.customers c
    ON c.client_id = i.client_id
   AND c.tenant_id = i.tenant_id
  WHERE i.id = p_return_income_id;

  v_tax_rows := public._pos_build_vfrs_return_tax_ledger_rows(
    p_tenant_id,
    p_return_income_id,
    v_row.date,
    v_gross,
    v_settings,
    v_counterparty,
    CASE
      WHEN nullif(btrim(v_row.invoice_no), '') IS NOT NULL
        THEN 'Product return ' || btrim(v_row.invoice_no)
      ELSE 'Product return'
    END
  );

  PERFORM public.replace_income_register_tax_ledger_entries(
    p_return_income_id::text,
    v_tax_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._post_customer_refund_cash_outflow(
  p_tenant_id uuid,
  p_credit_note public.credit_notes,
  p_refund_id uuid,
  p_amount numeric,
  p_method text,
  p_refund_date date,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expense_id uuid;
  v_receipt_no text;
BEGIN
  v_receipt_no := 'REFUND-' || btrim(p_credit_note.credit_note_number);

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
    business_unit_id,
    is_customer_refund
  )
  VALUES (
    p_tenant_id,
    p_refund_date,
    'Other',
    'Customer Refunds',
    'Customer refund for credit note ' || p_credit_note.credit_note_number,
    coalesce(nullif(btrim(p_method), ''), 'Cash'),
    p_amount,
    1,
    p_amount,
    coalesce(nullif(btrim(p_method), ''), 'Cash'),
    'System',
    v_receipt_no,
    'Paid',
    coalesce(
      nullif(btrim(p_notes), ''),
      'Linked to refunds ' || p_refund_id::text || ' and credit_notes ' || p_credit_note.id::text
    ),
    p_credit_note.business_unit_id,
    true
  )
  RETURNING id INTO v_expense_id;

  RETURN v_expense_id;
END;
$$;

REVOKE ALL ON FUNCTION public._return_prior_qty_for_sale_line(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sale_has_credit_notes(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._sale_cogs_unit_cost(public.income_register) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pos_build_vfrs_return_tax_ledger_rows(uuid, uuid, date, numeric, public.tax_settings, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._pos_sync_vfrs_for_return_income_id(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._post_customer_refund_cash_outflow(uuid, public.credit_notes, uuid, numeric, text, date, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public._return_prior_qty_for_sale_line(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._sale_has_credit_notes(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._sale_cogs_unit_cost(public.income_register) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pos_build_vfrs_return_tax_ledger_rows(uuid, uuid, date, numeric, public.tax_settings, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pos_sync_vfrs_for_return_income_id(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._post_customer_refund_cash_outflow(uuid, public.credit_notes, uuid, numeric, text, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._reverse_loyalty_points_for_product_return(
  p_tenant_id uuid,
  p_client_id text,
  p_pos_invoice_no text,
  p_return_gross numeric,
  p_credit_note_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_total numeric(18, 4);
  v_earned_points numeric(18, 4);
  v_target_points numeric(18, 4);
  v_deduct numeric(18, 4);
  v_account public.loyalty_accounts%ROWTYPE;
  v_notes text;
BEGIN
  IF p_client_id IS NULL OR btrim(p_client_id) = '' OR p_return_gross IS NULL OR p_return_gross <= 0 THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(i.amount), 0)
  INTO v_sale_total
  FROM public.income_register i
  WHERE i.tenant_id = p_tenant_id
    AND i.entry_type = 'product_sale'
    AND i.is_sale_return IS NOT TRUE
    AND i.invoice_no = p_pos_invoice_no
    AND i.amount > 0;

  IF v_sale_total <= 0 THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(lt.points), 0)
  INTO v_earned_points
  FROM public.loyalty_transactions lt
  WHERE lt.tenant_id = p_tenant_id
    AND lt.client_id = p_client_id
    AND lt.transaction_type = 'earn'
    AND lt.source_type = 'product_sale'
    AND lt.source_reference = p_pos_invoice_no;

  IF v_earned_points <= 0 THEN
    RETURN 0;
  END IF;

  v_target_points := floor(v_earned_points * p_return_gross / v_sale_total);
  IF v_target_points <= 0 THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_account
  FROM public.loyalty_accounts la
  WHERE la.tenant_id = p_tenant_id
    AND la.client_id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_deduct := least(v_target_points, v_account.points_balance);
  IF v_deduct <= 0 THEN
    IF v_target_points > 0 THEN
      INSERT INTO public.loyalty_transactions (
        tenant_id,
        client_id,
        transaction_type,
        points,
        source_type,
        source_reference,
        notes
      )
      VALUES (
        p_tenant_id,
        p_client_id,
        'adjustment',
        0,
        'product_return',
        p_credit_note_id::text,
        'Return ' || p_credit_note_id::text || ': ' || v_target_points::text
          || ' points would reverse but balance is zero (likely redeemed).'
      );
    END IF;
    RETURN 0;
  END IF;

  v_notes := 'Return credit note ' || p_credit_note_id::text;
  IF v_deduct < v_target_points THEN
    v_notes := v_notes || '; partial reversal only ('
      || v_deduct::text || ' of ' || v_target_points::text
      || ' points; remainder likely redeemed).';
  END IF;

  UPDATE public.loyalty_accounts la
  SET points_balance = la.points_balance - v_deduct,
      lifetime_earned = greatest(0, la.lifetime_earned - v_deduct),
      updated_at = now()
  WHERE la.id = v_account.id;

  INSERT INTO public.loyalty_transactions (
    tenant_id,
    client_id,
    transaction_type,
    points,
    source_type,
    source_reference,
    notes
  )
  VALUES (
    p_tenant_id,
    p_client_id,
    'adjustment',
    -v_deduct,
    'product_return',
    p_credit_note_id::text,
    v_notes
  );

  RETURN v_deduct;
END;
$$;

REVOKE ALL ON FUNCTION public._reverse_loyalty_points_for_product_return(uuid, text, text, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reverse_loyalty_points_for_product_return(uuid, text, text, numeric, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._record_refund_core(
  p_credit_note_id uuid,
  p_amount numeric,
  p_method text,
  p_notes text,
  p_refund_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.credit_notes;
  v_refund_id uuid;
  v_new_refunded numeric(18, 4);
  v_available numeric(18, 4);
  v_expense_id uuid;
BEGIN
  SELECT *
  INTO v_note
  FROM public.credit_notes
  WHERE id = p_credit_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  v_available := v_note.total_amount - v_note.refunded_amount - v_note.applied_amount;
  IF p_amount > v_available + 0.0001 THEN
    RAISE EXCEPTION 'Refund of % exceeds available customer credit % (total %, refunded %, applied %)',
      p_amount, v_available, v_note.total_amount, v_note.refunded_amount, v_note.applied_amount;
  END IF;

  IF v_note.refunded_amount + p_amount > v_note.total_amount + 0.0001 THEN
    RAISE EXCEPTION 'Refund of % would exceed credit note total %',
      p_amount, v_note.total_amount;
  END IF;

  INSERT INTO public.refunds (
    credit_note_id,
    tenant_id,
    amount,
    method,
    refund_date,
    notes
  )
  VALUES (
    p_credit_note_id,
    v_note.tenant_id,
    p_amount,
    p_method,
    coalesce(p_refund_date, CURRENT_DATE),
    p_notes
  )
  RETURNING id INTO v_refund_id;

  v_expense_id := public._post_customer_refund_cash_outflow(
    v_note.tenant_id,
    v_note,
    v_refund_id,
    p_amount,
    p_method,
    coalesce(p_refund_date, CURRENT_DATE),
    p_notes
  );

  UPDATE public.refunds
  SET expense_register_id = v_expense_id
  WHERE id = v_refund_id;

  v_new_refunded := v_note.refunded_amount + p_amount;

  UPDATE public.credit_notes
  SET refunded_amount = v_new_refunded,
      status = CASE
        WHEN v_new_refunded + applied_amount >= total_amount THEN 'refunded'
        WHEN v_new_refunded > 0 OR applied_amount > 0 THEN 'partially_refunded'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_credit_note_id;

  RETURN v_refund_id;
END;
$$;

REVOKE ALL ON FUNCTION public._record_refund_core(uuid, numeric, text, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._record_refund_core(uuid, numeric, text, text, date) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
