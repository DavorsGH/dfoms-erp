BEGIN;

CREATE OR REPLACE FUNCTION public.record_refund(
  p_credit_note_id uuid,
  p_amount numeric,
  p_method text,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  RETURN public._record_refund_core(
    p_credit_note_id,
    p_amount,
    p_method,
    p_notes,
    CURRENT_DATE
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_credit_note_to_income(
  p_tenant_id uuid,
  p_credit_note_id uuid,
  p_applications jsonb,
  p_applied_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_note public.credit_notes;
  v_item jsonb;
  v_target_id uuid;
  v_amount numeric(18, 4);
  v_total_apply numeric(18, 4) := 0;
  v_available numeric(18, 4);
  v_target public.income_register;
  v_i integer;
  v_count integer;
  v_application_ids uuid[] := ARRAY[]::uuid[];
  v_new_id uuid;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant is required';
  END IF;

  IF p_applications IS NULL
    OR jsonb_typeof(p_applications) <> 'array'
    OR jsonb_array_length(p_applications) = 0 THEN
    RAISE EXCEPTION 'applications must be a non-empty JSON array';
  END IF;

  PERFORM public.assert_not_view_all_business_units();

  IF public.current_user_tenant_id() IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Tenant mismatch';
  END IF;

  SELECT *
  INTO v_note
  FROM public.credit_notes
  WHERE id = p_credit_note_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  v_count := jsonb_array_length(p_applications);

  FOR v_i IN 0 .. v_count - 1 LOOP
    v_item := p_applications->v_i;
    v_amount := (v_item->>'amount')::numeric;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Application amount must be greater than zero';
    END IF;
    v_total_apply := v_total_apply + v_amount;
  END LOOP;

  v_available := v_note.total_amount - v_note.refunded_amount - v_note.applied_amount;
  IF v_total_apply > v_available + 0.0001 THEN
    RAISE EXCEPTION 'Application total % exceeds available customer credit %',
      v_total_apply, v_available;
  END IF;

  FOR v_i IN 0 .. v_count - 1 LOOP
    v_item := p_applications->v_i;
    v_target_id := (v_item->>'income_register_id')::uuid;
    v_amount := (v_item->>'amount')::numeric;

    SELECT *
    INTO v_target
    FROM public.income_register
    WHERE id = v_target_id
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target income row not found';
    END IF;

    IF v_target.is_sale_return IS TRUE OR v_target.amount < 0 THEN
      RAISE EXCEPTION 'Cannot apply credit to a return income row';
    END IF;

    IF v_target.sale_status = 'voided' THEN
      RAISE EXCEPTION 'Cannot apply credit to voided sale income';
    END IF;

    INSERT INTO public.credit_note_applications (
      tenant_id,
      credit_note_id,
      target_income_register_id,
      amount,
      applied_date,
      notes
    )
    VALUES (
      p_tenant_id,
      p_credit_note_id,
      v_target_id,
      v_amount,
      coalesce(p_applied_date, CURRENT_DATE),
      nullif(btrim(v_item->>'notes'), '')
    )
    RETURNING id INTO v_new_id;

    v_application_ids := array_append(v_application_ids, v_new_id);

    UPDATE public.income_register
    SET amount_received = coalesce(amount_received, 0) + v_amount,
        outstanding_balance = NULL
    WHERE id = v_target_id
      AND tenant_id = p_tenant_id;
  END LOOP;

  UPDATE public.credit_notes
  SET applied_amount = applied_amount + v_total_apply,
      status = CASE
        WHEN refunded_amount + applied_amount + v_total_apply >= total_amount THEN 'refunded'
        WHEN refunded_amount > 0 OR applied_amount + v_total_apply > 0 THEN 'partially_refunded'
        ELSE status
      END,
      updated_at = now()
  WHERE id = p_credit_note_id;

  RETURN jsonb_build_object(
    'credit_note_id', p_credit_note_id,
    'applied_amount', v_total_apply,
    'application_ids', to_jsonb(v_application_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.void_product_sale(p_income_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale income_register%ROWTYPE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_reversal_expense_id UUID;
  v_reversal_receipt_no TEXT;
  v_alloc_rec RECORD;
BEGIN
  IF public._sale_has_credit_notes(p_income_id) THEN
    RAISE EXCEPTION 'This sale has product return credit notes. Use Return instead of Void.';
  END IF;

  SELECT *
  INTO v_sale
  FROM income_register
  WHERE id = p_income_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product sale not found';
  END IF;
  IF v_sale.entry_type IS DISTINCT FROM 'product_sale' THEN
    RAISE EXCEPTION 'Only product sale entries can be voided';
  END IF;
  IF v_sale.sale_status = 'voided' THEN
    RAISE EXCEPTION 'Product sale % is already voided', v_sale.invoice_no;
  END IF;
  IF v_sale.is_sale_return IS TRUE THEN
    RAISE EXCEPTION 'Return income rows cannot be voided';
  END IF;
  IF v_sale.product_id IS NULL OR v_sale.sale_quantity IS NULL OR v_sale.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Product sale % is missing product quantity details', v_sale.invoice_no;
  END IF;
  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = v_sale.product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found for sale %', v_sale.invoice_no;
  END IF;
  IF v_sale.cogs_expense_id IS NOT NULL THEN
    SELECT amount, price
    INTO v_cogs_amount, v_cogs_unit_cost
    FROM expense_register
    WHERE id = v_sale.cogs_expense_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked COGS expense not found for sale %', v_sale.invoice_no;
    END IF;
  END IF;

  FOR v_alloc_rec IN (
    SELECT batch_source, batch_id, quantity_allocated
    FROM sale_batch_allocations
    WHERE sale_id = v_sale.id AND sale_source = 'product_sale'
  ) LOOP
    IF v_alloc_rec.batch_source = 'production_batch' THEN
      UPDATE production_batches SET remaining_quantity = remaining_quantity + v_alloc_rec.quantity_allocated WHERE id = v_alloc_rec.batch_id;
    ELSIF v_alloc_rec.batch_source = 'product_purchase' THEN
      UPDATE product_purchases SET remaining_quantity = remaining_quantity + v_alloc_rec.quantity_allocated WHERE id = v_alloc_rec.batch_id;
    END IF;

    INSERT INTO sale_batch_allocations (tenant_id, sale_id, sale_source, finished_product_id, batch_source, batch_id, quantity_allocated)
    VALUES (v_sale.tenant_id, v_sale.id, 'product_sale', v_sale.product_id, v_alloc_rec.batch_source, v_alloc_rec.batch_id, -v_alloc_rec.quantity_allocated);
  END LOOP;

  UPDATE finished_products
  SET
    current_stock = current_stock + v_sale.sale_quantity,
    updated_at = now()
  WHERE id = v_sale.product_id;

  PERFORM public.adjust_finished_product_balance_qty(
    v_sale.tenant_id,
    v_sale.product_id,
    v_sale.business_unit_id,
    v_sale.sale_quantity
  );

  INSERT INTO stock_movements (
    tenant_id,
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
  )
  VALUES (
    v_sale.tenant_id,
    v_sale.product_id, 'adjustment', v_sale.sale_quantity, v_sale.id,
    COALESCE(v_sale.date, CURRENT_DATE),
    'Reversal of voided sale ' || v_sale.invoice_no,
    v_sale.business_unit_id
  );
  IF v_sale.cogs_expense_id IS NOT NULL AND v_cogs_amount <> 0 THEN
    v_reversal_receipt_no := 'VOID-COGS-' || TRIM(v_sale.invoice_no);
    INSERT INTO expense_register (
      tenant_id,
      date, expense_category, sub_category, description, vendor, price,
      quantity, amount, payment_method, approved_by, receipt_no, payment_status, notes,
      business_unit_id
    )
    VALUES (
      v_sale.tenant_id,
      COALESCE(v_sale.date, CURRENT_DATE),
      'Cost of Goods Sold',
      'Product Sales',
      'COGS reversal for voided product sale ' || v_sale.invoice_no || ' (' || v_product_name || ')',
      'Internal', -ABS(v_cogs_unit_cost), v_sale.sale_quantity, -ABS(v_cogs_amount),
      'Internal', 'System', v_reversal_receipt_no, 'Non-Cash',
      'Reversal of expense_register ' || v_sale.cogs_expense_id::TEXT
        || ' linked to voided income_register ' || v_sale.id::TEXT,
      v_sale.business_unit_id
    )
    RETURNING id INTO v_reversal_expense_id;
  END IF;
  UPDATE income_register
  SET
    sale_status = 'voided',
    voided_at = now(),
    cogs_reversal_expense_id = v_reversal_expense_id
  WHERE id = v_sale.id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_refund(uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_refund(uuid, numeric, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.apply_credit_note_to_income(uuid, uuid, jsonb, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_product_sale(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_refund(uuid, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_credit_note_to_income(uuid, uuid, jsonb, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_product_sale(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
