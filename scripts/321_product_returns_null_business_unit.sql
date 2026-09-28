BEGIN;
CREATE OR REPLACE FUNCTION public.pos_create_product_return(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_return_date date,
  p_pos_invoice_no text,
  p_reason text,
  p_lines jsonb,
  p_mode text,
  p_refund_method text DEFAULT NULL,
  p_refund_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_sale public.income_register;
  v_credit_note_id uuid;
  v_credit_note_client_id text;
  v_credit_note_number text;
  v_subtotal numeric(18, 4) := 0;
  v_tax_total numeric(18, 4) := 0;
  v_product_id uuid;
  v_return_qty numeric(18, 4);
  v_unit_price numeric(18, 4);
  v_line_gross numeric(18, 4);
  v_disposition text;
  v_prior numeric(18, 4);
  v_remaining numeric(18, 4);
  v_restocked numeric(18, 4);
  v_batch_rec record;
  v_alloc_qty numeric(18, 4);
  v_cogs_unit_cost numeric(18, 4);
  v_line_cogs_amount numeric(18, 4);
  v_line_reversal_expense_id uuid;
  v_return_income_id uuid;
  v_return_income_ids uuid[] := ARRAY[]::uuid[];
  v_refund_id uuid;
  v_invoice_no text;
  v_i integer;
  v_line_count integer;
  v_settings public.tax_settings;
  v_tax jsonb;
  v_output_vat numeric(18, 4);
  v_net numeric(18, 4);
  v_mode text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required';
  END IF;

  IF p_return_date IS NULL THEN
    RAISE EXCEPTION 'Return date is required';
  END IF;

  v_invoice_no := nullif(btrim(coalesce(p_pos_invoice_no, '')), '');
  IF v_invoice_no IS NULL THEN
    RAISE EXCEPTION 'POS invoice number is required';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'lines must be a non-empty JSON array';
  END IF;

  v_mode := lower(btrim(coalesce(p_mode, '')));
  IF v_mode NOT IN ('store_credit', 'refund_now', 'exchange_hold') THEN
    RAISE EXCEPTION 'Invalid return mode: %', p_mode;
  END IF;

  PERFORM public.assert_not_view_all_business_units();

  IF public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Tenant mismatch';
  END IF;

  v_line_count := jsonb_array_length(p_lines);

  FOR v_i IN 0 .. v_line_count - 1 LOOP
    v_line := p_lines->v_i;
    SELECT *
    INTO v_sale
    FROM public.income_register
    WHERE id = (v_line->>'income_register_id')::uuid
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sale line not found';
    END IF;

    IF v_sale.tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Sale tenant mismatch';
    END IF;

    IF v_sale.business_unit_id IS DISTINCT FROM p_business_unit_id THEN
      RAISE EXCEPTION 'Sale business unit mismatch';
    END IF;

    IF v_sale.entry_type IS DISTINCT FROM 'product_sale' THEN
      RAISE EXCEPTION 'Only product sale lines can be returned';
    END IF;

    IF v_sale.sale_status = 'voided' THEN
      RAISE EXCEPTION 'Cannot return voided sale %', coalesce(v_sale.invoice_no, v_sale.id::text);
    END IF;

    IF nullif(btrim(coalesce(v_sale.invoice_no, '')), '') IS DISTINCT FROM v_invoice_no THEN
      RAISE EXCEPTION 'Sale invoice % does not match receipt %', v_sale.invoice_no, v_invoice_no;
    END IF;

    v_product_id := (v_line->>'product_id')::uuid;
    IF v_product_id IS DISTINCT FROM v_sale.product_id THEN
      RAISE EXCEPTION 'Product mismatch for sale %', v_sale.invoice_no;
    END IF;

    v_return_qty := (v_line->>'quantity')::numeric;
    IF v_return_qty IS NULL OR v_return_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be greater than zero';
    END IF;

    v_prior := public._return_prior_qty_for_sale_line(p_tenant_id, v_sale.id, v_product_id);
    IF v_prior + v_return_qty > coalesce(v_sale.sale_quantity, 0) + 0.0001 THEN
      RAISE EXCEPTION 'Return quantity % exceeds remaining returnable % for sale %',
        v_return_qty, coalesce(v_sale.sale_quantity, 0) - v_prior, v_sale.invoice_no;
    END IF;
  END LOOP;

  v_credit_note_number := public.generate_next_code(p_tenant_id, 'CRNPS', 4);
  v_settings := public._pos_pick_tax_settings(p_tenant_id, p_business_unit_id);

  SELECT ir.client_id
  INTO v_credit_note_client_id
  FROM public.income_register ir
  WHERE ir.id = ((p_lines->0)->>'income_register_id')::uuid;

  INSERT INTO public.credit_notes (
    tenant_id,
    client_id,
    source_type,
    source_income_register_id,
    credit_note_number,
    credit_note_date,
    reason,
    business_unit_id,
    pos_invoice_no,
    return_mode
  )
  VALUES (
    p_tenant_id,
    v_credit_note_client_id,
    'product_sale',
    NULL,
    v_credit_note_number,
    p_return_date,
    p_reason,
    p_business_unit_id,
    v_invoice_no,
    v_mode
  )
  RETURNING id INTO v_credit_note_id;

  FOR v_i IN 0 .. v_line_count - 1 LOOP
    v_line := p_lines->v_i;

    SELECT *
    INTO v_sale
    FROM public.income_register
    WHERE id = (v_line->>'income_register_id')::uuid
    FOR UPDATE;

    v_product_id := v_sale.product_id;
    v_return_qty := (v_line->>'quantity')::numeric;
    v_unit_price := coalesce((v_line->>'unit_price')::numeric, v_sale.unit_price, 0);
    v_line_gross := public._pos_round_money(v_return_qty * v_unit_price);
    v_disposition := lower(coalesce(nullif(btrim(v_line->>'disposition'), ''), 'restock'));

    IF v_disposition NOT IN ('restock', 'writeoff') THEN
      RAISE EXCEPTION 'Invalid disposition: %', v_disposition;
    END IF;

    v_tax := public._pos_compute_vfrs_output_tax(v_line_gross, v_settings);
    v_output_vat := public._pos_round_money(coalesce((v_tax->>'output_vat_amount')::numeric, 0));
    v_net := public._pos_round_money(coalesce((v_tax->>'net_of_tax_amount')::numeric, v_line_gross));

    v_subtotal := v_subtotal + v_line_gross;
    v_tax_total := v_tax_total + v_output_vat;

    INSERT INTO public.credit_note_line_items (
      credit_note_id,
      tenant_id,
      product_id,
      description,
      quantity,
      unit_price,
      total_amount,
      source_income_register_id,
      business_unit_id,
      disposition,
      tax_amount,
      output_vat_amount
    )
    VALUES (
      v_credit_note_id,
      p_tenant_id,
      v_product_id,
      coalesce(nullif(btrim(v_line->>'description'), ''), 'Product return'),
      v_return_qty,
      v_unit_price,
      v_line_gross,
      v_sale.id,
      p_business_unit_id,
      v_disposition,
      v_output_vat,
      v_output_vat
    );

    INSERT INTO public.income_register (
      tenant_id,
      date,
      invoice_no,
      client_id,
      customer_name,
      entry_type,
      description,
      amount,
      amount_received,
      outstanding_balance,
      payment_status,
      wht_amount,
      notes,
      product_id,
      sale_quantity,
      unit_price,
      business_unit_id,
      sales_rep_id,
      credit_note_id,
      source_income_register_id,
      is_sale_return
    )
    VALUES (
      p_tenant_id,
      p_return_date,
      v_invoice_no,
      v_sale.client_id,
      v_sale.customer_name,
      'product_sale',
      'Return ' || v_credit_note_number || ' against sale ' || coalesce(v_sale.invoice_no, v_sale.id::text),
      -v_line_gross,
      0,
      0,
      'Non-Cash',
      0,
      'Credit note ' || v_credit_note_number,
      v_sale.product_id,
      v_return_qty,
      coalesce((v_line->>'unit_price')::numeric, v_sale.unit_price, 0),
      v_sale.business_unit_id,
      v_sale.sales_rep_id,
      v_credit_note_id,
      v_sale.id,
      true
    )
    RETURNING id INTO v_return_income_id;

    v_return_income_ids := array_append(v_return_income_ids, v_return_income_id);
    PERFORM public._pos_sync_vfrs_for_return_income_id(p_tenant_id, v_return_income_id);

    v_cogs_unit_cost := public._sale_cogs_unit_cost(v_sale);

    IF v_disposition = 'restock' THEN
      v_remaining := v_return_qty;

      FOR v_batch_rec IN (
        SELECT batch_source, batch_id, sum(quantity_allocated) AS net_qty, min(created_at) AS first_seen
        FROM public.sale_batch_allocations
        WHERE sale_id = v_sale.id
          AND sale_source = 'product_sale'
          AND finished_product_id = v_product_id
        GROUP BY batch_source, batch_id
        HAVING sum(quantity_allocated) > 0
        ORDER BY min(created_at) ASC
      ) LOOP
        EXIT WHEN v_remaining <= 0;
        v_alloc_qty := least(v_remaining, v_batch_rec.net_qty);

        IF v_batch_rec.batch_source = 'production_batch' THEN
          UPDATE public.production_batches
          SET remaining_quantity = remaining_quantity + v_alloc_qty
          WHERE id = v_batch_rec.batch_id;
        ELSIF v_batch_rec.batch_source = 'product_purchase' THEN
          UPDATE public.product_purchases
          SET remaining_quantity = remaining_quantity + v_alloc_qty
          WHERE id = v_batch_rec.batch_id;
        END IF;

        INSERT INTO public.sale_batch_allocations (
          tenant_id,
          sale_id,
          sale_source,
          finished_product_id,
          batch_source,
          batch_id,
          quantity_allocated
        )
        VALUES (
          p_tenant_id,
          v_sale.id,
          'product_sale',
          v_product_id,
          v_batch_rec.batch_source,
          v_batch_rec.batch_id,
          -v_alloc_qty
        );

        v_remaining := v_remaining - v_alloc_qty;
      END LOOP;

      v_restocked := v_return_qty;

      UPDATE public.finished_products
      SET current_stock = current_stock + v_restocked, updated_at = now()
      WHERE id = v_product_id;

      PERFORM public.adjust_finished_product_balance_qty(
        p_tenant_id,
        v_product_id,
        p_business_unit_id,
        v_restocked
      );

      INSERT INTO public.stock_movements (
        tenant_id,
        product_id,
        movement_type,
        quantity,
        reference_id,
        movement_date,
        notes,
        business_unit_id
      )
      VALUES (
        p_tenant_id,
        v_product_id,
        'adjustment',
        v_restocked,
        v_credit_note_id,
        p_return_date,
        'Return restock ' || v_credit_note_number || ' sale ' || coalesce(v_sale.invoice_no, v_sale.id::text),
        p_business_unit_id
      );

      v_line_cogs_amount := public._pos_round_money(v_restocked * v_cogs_unit_cost);
      IF v_line_cogs_amount <> 0 THEN
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
          p_return_date,
          'Cost of Goods Sold',
          'Product Returns',
          'COGS reversal for return ' || v_credit_note_number || ' line ' || v_return_income_id::text,
          'Internal',
          -abs(v_cogs_unit_cost),
          v_restocked,
          -abs(v_line_cogs_amount),
          'Internal',
          'System',
          'RET-COGS-' || v_credit_note_number || '-' || left(replace(v_return_income_id::text, '-', ''), 8),
          'Non-Cash',
          'Linked to credit_notes ' || v_credit_note_id::text
            || ' and income_register ' || v_return_income_id::text,
          p_business_unit_id
        )
        RETURNING id INTO v_line_reversal_expense_id;

        UPDATE public.income_register
        SET cogs_reversal_expense_id = v_line_reversal_expense_id
        WHERE id = v_return_income_id;
      END IF;
    ELSE
      INSERT INTO public.stock_movements (
        tenant_id,
        product_id,
        movement_type,
        quantity,
        reference_id,
        movement_date,
        notes,
        business_unit_id
      )
      VALUES (
        p_tenant_id,
        v_product_id,
        'return_writeoff',
        0,
        v_credit_note_id,
        p_return_date,
        'Return write-off ' || v_credit_note_number || ' sale ' || coalesce(v_sale.invoice_no, v_sale.id::text),
        p_business_unit_id
      );
    END IF;
  END LOOP;

  UPDATE public.credit_notes
  SET subtotal = v_subtotal, total_amount = v_subtotal
  WHERE id = v_credit_note_id;

  PERFORM public._reverse_loyalty_points_for_product_return(
    p_tenant_id,
    v_credit_note_client_id,
    v_invoice_no,
    v_subtotal,
    v_credit_note_id
  );

  IF v_mode = 'refund_now' THEN
    v_refund_id := public._record_refund_core(
      v_credit_note_id,
      v_subtotal,
      coalesce(nullif(btrim(p_refund_method), ''), 'Cash'),
      p_refund_notes,
      p_return_date
    );
  END IF;

  RETURN jsonb_build_object(
    'credit_note_id', v_credit_note_id,
    'credit_note_number', v_credit_note_number,
    'return_income_ids', to_jsonb(v_return_income_ids),
    'refund_id', v_refund_id
  );
END;
$$;
COMMIT;

NOTIFY pgrst, 'reload schema';
