BEGIN;

CREATE OR REPLACE FUNCTION public.finished_product_weighted_avg_cost_scoped(
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT COALESCE(
    ROUND(
      GREATEST(
        (
          COALESCE((
            SELECT SUM(pb.total_batch_cost)
            FROM public.production_batches pb
            WHERE pb.finished_product_id = p_product_id
              AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          ), 0)
          + COALESCE((
            SELECT SUM(pp.total_cost)
            FROM public.product_purchases pp
            WHERE pp.product_id = p_product_id
              AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          ), 0)
          - COALESCE((
            SELECT SUM(e.amount)
            FROM public.income_register i
            JOIN public.expense_register e
              ON e.id = i.cogs_expense_id
              OR e.id = i.cogs_reversal_expense_id
            WHERE i.product_id = p_product_id
              AND i.entry_type = 'product_sale'
              AND i.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          ), 0)
          - COALESCE((
            SELECT SUM(e.amount)
            FROM public.internal_consumption ic
            JOIN public.expense_register e ON e.id = ic.expense_register_id
            WHERE ic.product_id = p_product_id
              AND ic.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          ), 0)
          + COALESCE((
            SELECT SUM(fsa.quantity_delta * fsa.cost_per_unit)
            FROM public.finished_product_stock_adjustments fsa
            WHERE fsa.product_id = p_product_id
              AND fsa.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          ), 0)
        ),
        0
      ) / NULLIF((
        SELECT fpb.current_stock
        FROM public.finished_product_balances fpb
        WHERE fpb.product_id = p_product_id
          AND fpb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      ), 0),
      4
    ),
    0
  );
$function$;

REVOKE ALL ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finished_product_balance_restock_at_unit_cost(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_qty numeric,
  p_unit_cost numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_old_stock numeric(18, 4);
  v_old_avg numeric(18, 4);
  v_new_stock numeric(18, 4);
  v_new_avg numeric(18, 4);
  v_unit numeric(18, 4);
BEGIN
  IF p_tenant_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and product_id are required';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'restock quantity must be positive (got %)', p_qty;
  END IF;

  v_unit := round(greatest(coalesce(p_unit_cost, 0), 0), 4);

  PERFORM public.ensure_finished_product_balance(
    p_tenant_id,
    p_product_id,
    p_business_unit_id
  );

  SELECT current_stock, average_cost_per_unit
  INTO v_old_stock, v_old_avg
  FROM public.finished_product_balances
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  FOR UPDATE;

  v_old_stock := coalesce(v_old_stock, 0);
  v_old_avg := coalesce(v_old_avg, 0);
  v_new_stock := v_old_stock + p_qty;

  IF v_new_stock <= 0 THEN
    v_new_avg := 0;
  ELSE
    v_new_avg := round(
      (v_old_stock * v_old_avg + p_qty * v_unit) / v_new_stock,
      4
    );
  END IF;

  IF v_new_avg < 0 THEN
    RAISE EXCEPTION
      'Inventory weighted-average cost cannot be negative for product % in business unit % (computed %)',
      p_product_id,
      p_business_unit_id,
      v_new_avg;
  END IF;

  UPDATE public.finished_product_balances
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finished_product_balance_restock_at_unit_cost(uuid, uuid, uuid, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finished_product_balance_restock_at_unit_cost(uuid, uuid, uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.finished_product_balance_restock_at_unit_cost(uuid, uuid, uuid, numeric, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.adjust_finished_product_balance_qty(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_qty_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_wac numeric(18, 4);
BEGIN
  PERFORM public.ensure_finished_product_balance(
    p_tenant_id,
    p_product_id,
    p_business_unit_id
  );

  UPDATE public.finished_product_balances
  SET current_stock = current_stock + p_qty_delta,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  v_wac := coalesce(
    public.finished_product_weighted_avg_cost_scoped(p_product_id, p_business_unit_id),
    0
  );

  IF v_wac < 0 THEN
    RAISE EXCEPTION
      'Inventory weighted-average cost cannot be negative for product % in business unit % (computed %). Repair restock/return COGS links or recompute WAC from history.',
      p_product_id,
      p_business_unit_id,
      v_wac;
  END IF;

  UPDATE public.finished_product_balances
  SET average_cost_per_unit = v_wac,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_finished_product_balances_wac_non_negative()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.average_cost_per_unit IS NOT NULL
     AND NEW.average_cost_per_unit < 0
     AND coalesce(NEW.current_stock, 0) > 0 THEN
    RAISE EXCEPTION
      'finished_product_balances.average_cost_per_unit cannot be negative when stock is positive (product %, business unit %, wac %)',
      NEW.product_id,
      NEW.business_unit_id,
      NEW.average_cost_per_unit;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finished_product_balances_wac_non_negative
  ON public.finished_product_balances;
CREATE TRIGGER finished_product_balances_wac_non_negative
  BEFORE INSERT OR UPDATE OF average_cost_per_unit, current_stock
  ON public.finished_product_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_finished_product_balances_wac_non_negative();

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
