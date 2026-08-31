BEGIN;

CREATE OR REPLACE FUNCTION public.recalculate_raw_material_inventory_scoped(
  p_material_id uuid,
  p_business_unit_id uuid
)
RETURNS TABLE(current_stock numeric, average_cost_per_unit numeric)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_tenant_id UUID;
  v_purchased_qty NUMERIC(18, 4) := 0;
  v_purchased_value NUMERIC(18, 4) := 0;
  v_consumed_qty NUMERIC(18, 4) := 0;
  v_new_stock NUMERIC(18, 4) := 0;
  v_new_avg NUMERIC(18, 4) := 0;
  v_purchase RECORD;
BEGIN
  SELECT tenant_id
  INTO v_tenant_id
  FROM raw_materials
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  FOR v_purchase IN
    SELECT quantity, cost_per_unit
    FROM raw_material_purchases
    WHERE material_id = p_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    ORDER BY created_at, id
  LOOP
    v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    v_purchased_value := v_purchased_value
      + ROUND(v_purchase.quantity * v_purchase.cost_per_unit, 4);
  END LOOP;

  SELECT COALESCE(SUM(pbm.quantity_used), 0)
  INTO v_consumed_qty
  FROM production_batch_materials pbm
  JOIN production_batches pb ON pb.id = pbm.batch_id
  WHERE pbm.material_id = p_material_id
    AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  v_new_stock := v_purchased_qty - v_consumed_qty;

  IF v_purchased_qty > 0 THEN
    v_new_avg := ROUND(v_purchased_value / v_purchased_qty, 4);
  ELSE
    v_new_avg := 0;
  END IF;

  PERFORM public.ensure_raw_material_balance(
    v_tenant_id,
    p_material_id,
    p_business_unit_id
  );

  UPDATE public.raw_material_balances
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  current_stock := v_new_stock;
  average_cost_per_unit := v_new_avg;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cascade_raw_material_cost_to_batches_scoped(
  p_material_id uuid,
  p_business_unit_id uuid
)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchased_qty NUMERIC(18, 4) := 0;
  v_purchased_value NUMERIC(18, 4) := 0;
  v_lifetime_wac NUMERIC(18, 4) := 0;
  v_batch_id UUID;
  v_batch_total NUMERIC(18, 4);
  v_qty_produced NUMERIC(18, 4);
  v_batches_updated INTEGER := 0;
BEGIN
  IF p_material_id IS NULL THEN
    RAISE EXCEPTION 'material_id is required';
  END IF;

  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(ROUND(quantity * cost_per_unit, 4)), 0)
  INTO v_purchased_qty, v_purchased_value
  FROM raw_material_purchases
  WHERE material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  IF v_purchased_qty > 0 THEN
    v_lifetime_wac := ROUND(v_purchased_value / v_purchased_qty, 4);
  ELSE
    v_lifetime_wac := 0;
  END IF;

  UPDATE production_batch_materials pbm
  SET cost_at_time = v_lifetime_wac
  FROM production_batches pb
  WHERE pbm.batch_id = pb.id
    AND pbm.material_id = p_material_id
    AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND pbm.cost_at_time IS DISTINCT FROM v_lifetime_wac;

  FOR v_batch_id IN
    SELECT DISTINCT pbm.batch_id
    FROM production_batch_materials pbm
    JOIN production_batches pb ON pb.id = pbm.batch_id
    WHERE pbm.material_id = p_material_id
      AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LOOP
    SELECT COALESCE(SUM(ROUND(quantity_used * cost_at_time, 4)), 0)
    INTO v_batch_total
    FROM production_batch_materials
    WHERE batch_id = v_batch_id;

    SELECT quantity_produced
    INTO v_qty_produced
    FROM production_batches
    WHERE id = v_batch_id
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    UPDATE production_batches
    SET
      total_batch_cost = v_batch_total,
      cost_per_unit_produced = CASE
        WHEN v_qty_produced > 0 THEN ROUND(v_batch_total / v_qty_produced, 4)
        ELSE 0
      END
    WHERE id = v_batch_id;

    v_batches_updated := v_batches_updated + 1;
  END LOOP;

  RETURN v_batches_updated;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_raw_material_purchase(
  p_purchase_id uuid,
  p_purchase_date date,
  p_quantity numeric,
  p_cost_per_unit numeric,
  p_supplier text,
  p_payment_method text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
  v_total_cost NUMERIC(18, 4);
  v_business_unit_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Purchase quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  IF p_payment_method IS NULL OR TRIM(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for raw material purchases';
  END IF;

  SELECT *
  INTO v_purchase
  FROM raw_material_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material purchase % not found', p_purchase_id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_cost_per_unit, 4);

  PERFORM assert_raw_material_stock_not_negative(
    v_purchase.material_id,
    p_override_purchase_id => p_purchase_id,
    p_override_quantity => p_quantity,
    p_action => 'save'
  );

  PERFORM sync_raw_material_purchase_payable(
    p_purchase_id,
    v_purchase.material_id,
    p_purchase_date,
    p_supplier,
    p_payment_method,
    v_total_cost,
    v_purchase.accounts_payable_id
  );

  UPDATE raw_material_purchases
  SET
    purchase_date = p_purchase_date,
    quantity = p_quantity,
    cost_per_unit = p_cost_per_unit,
    total_cost = v_total_cost,
    supplier = NULLIF(TRIM(p_supplier), ''),
    payment_method = TRIM(p_payment_method),
    notes = NULLIF(TRIM(p_notes), '')
  WHERE id = p_purchase_id;

  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);

  PERFORM recalculate_raw_material_inventory_scoped(
    v_purchase.material_id,
    v_purchase.business_unit_id
  );

  FOR v_business_unit_id IN
    SELECT DISTINCT pb.business_unit_id
    FROM production_batch_materials pbm
    JOIN production_batches pb ON pb.id = pbm.batch_id
    WHERE pbm.material_id = v_purchase.material_id
  LOOP
    PERFORM cascade_raw_material_cost_to_batches_scoped(
      v_purchase.material_id,
      v_business_unit_id
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_raw_material_purchase(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
  v_business_unit_id UUID;
BEGIN
  SELECT *
  INTO v_purchase
  FROM raw_material_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material purchase % not found', p_purchase_id;
  END IF;

  PERFORM assert_raw_material_stock_not_negative(
    v_purchase.material_id,
    p_exclude_purchase_id => p_purchase_id
  );

  PERFORM reverse_raw_material_purchase_payable(v_purchase.accounts_payable_id);

  DELETE FROM raw_material_purchases
  WHERE id = p_purchase_id;

  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);

  PERFORM recalculate_raw_material_inventory_scoped(
    v_purchase.material_id,
    v_purchase.business_unit_id
  );

  FOR v_business_unit_id IN
    SELECT DISTINCT pb.business_unit_id
    FROM production_batch_materials pbm
    JOIN production_batches pb ON pb.id = pbm.batch_id
    WHERE pbm.material_id = v_purchase.material_id
  LOOP
    PERFORM cascade_raw_material_cost_to_batches_scoped(
      v_purchase.material_id,
      v_business_unit_id
    );
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_raw_material_inventory_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_raw_material_inventory_scoped(uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cascade_raw_material_cost_to_batches_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cascade_raw_material_cost_to_batches_scoped(uuid, uuid)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
