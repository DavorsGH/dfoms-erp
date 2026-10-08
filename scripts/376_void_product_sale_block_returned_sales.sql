BEGIN;

CREATE OR REPLACE FUNCTION public.void_product_sale(p_income_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_sale income_register%ROWTYPE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_reversal_expense_id UUID;
  v_reversal_receipt_no TEXT;
  v_alloc_rec RECORD;
  v_returned_qty NUMERIC(18, 4) := 0;
BEGIN
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

  v_returned_qty := public._return_prior_qty_for_sale_line(
    v_sale.tenant_id,
    p_income_id,
    v_sale.product_id
  );

  IF coalesce(v_returned_qty, 0) >= v_sale.sale_quantity - 0.0001 THEN
    RAISE EXCEPTION 'This sale has been fully returned. Nothing left to cancel.';
  END IF;

  IF coalesce(v_returned_qty, 0) > 0.0001 THEN
    RAISE EXCEPTION 'This sale is partly returned. Return the remaining items instead of cancelling the sale.';
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
    IF v_sale.sale_quantity > 0 AND v_cogs_amount IS NOT NULL THEN
      v_cogs_unit_cost := round(abs(v_cogs_amount) / v_sale.sale_quantity, 4);
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

  PERFORM public.finished_product_balance_restock_at_unit_cost(
    v_sale.tenant_id,
    v_sale.product_id,
    v_sale.business_unit_id,
    v_sale.sale_quantity,
    coalesce(v_cogs_unit_cost, 0)
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
$function$;

REVOKE ALL ON FUNCTION public.void_product_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_product_sale(uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
