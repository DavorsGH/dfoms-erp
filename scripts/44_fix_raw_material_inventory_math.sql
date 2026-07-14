-- Script 44: Fix raw material inventory math and add ledger reconciliation.
-- Root issue: current_stock / average_cost_per_unit are derived fields that can
-- drift from the purchase + batch consumption ledger (as seen on RM-001).
-- Fixes:
--   1. Value-based weighted average in apply_raw_material_purchase (more stable).
--   2. create_production_batch validates and consumes each material in one pass.
--   3. recalculate_raw_material_inventory() rebuilds balances from source rows.

BEGIN;

CREATE OR REPLACE FUNCTION recalculate_raw_material_inventory(p_material_id UUID)
RETURNS TABLE (
  current_stock NUMERIC(18, 4),
  average_cost_per_unit NUMERIC(18, 4)
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchased_qty NUMERIC(18, 4) := 0;
  v_purchased_value NUMERIC(18, 4) := 0;
  v_consumed_qty NUMERIC(18, 4) := 0;
  v_new_stock NUMERIC(18, 4) := 0;
  v_new_avg NUMERIC(18, 4) := 0;
  v_purchase RECORD;
BEGIN
  FOR v_purchase IN
    SELECT quantity, cost_per_unit
    FROM raw_material_purchases
    WHERE material_id = p_material_id
    ORDER BY created_at, id
  LOOP
    v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    v_purchased_value :=
      v_purchased_value + ROUND(v_purchase.quantity * v_purchase.cost_per_unit, 4);
  END LOOP;

  SELECT COALESCE(SUM(quantity_used), 0)
  INTO v_consumed_qty
  FROM production_batch_materials
  WHERE material_id = p_material_id;

  v_new_stock := v_purchased_qty - v_consumed_qty;

  IF v_purchased_qty > 0 THEN
    v_new_avg := ROUND(v_purchased_value / v_purchased_qty, 4);
  ELSE
    v_new_avg := 0;
  END IF;

  UPDATE raw_materials
  SET
    current_stock = v_new_stock,
    average_cost_per_unit = v_new_avg,
    updated_at = now()
  WHERE id = p_material_id;

  current_stock := v_new_stock;
  average_cost_per_unit := v_new_avg;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION apply_raw_material_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_stock NUMERIC(18, 4);
  v_old_avg NUMERIC(18, 4);
  v_old_value NUMERIC(18, 4);
  v_new_stock NUMERIC(18, 4);
  v_new_value NUMERIC(18, 4);
  v_new_avg NUMERIC(18, 4);
BEGIN
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 4);

  SELECT current_stock, average_cost_per_unit
  INTO v_old_stock, v_old_avg
  FROM raw_materials
  WHERE id = NEW.material_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found for purchase', NEW.material_id;
  END IF;

  v_old_value := ROUND(v_old_stock * v_old_avg, 4);
  v_new_stock := v_old_stock + NEW.quantity;
  v_new_value := v_old_value + NEW.total_cost;

  IF v_new_stock <= 0 THEN
    v_new_avg := 0;
  ELSE
    v_new_avg := ROUND(v_new_value / v_new_stock, 4);
  END IF;

  UPDATE raw_materials
  SET
    current_stock = v_new_stock,
    average_cost_per_unit = v_new_avg,
    updated_at = now()
  WHERE id = NEW.material_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION create_production_batch(
  p_batch_number TEXT,
  p_production_date DATE,
  p_finished_product_id UUID,
  p_quantity_produced NUMERIC,
  p_notes TEXT,
  p_materials JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id UUID;
  v_material JSONB;
  v_material_id UUID;
  v_quantity_used NUMERIC(18, 4);
  v_cost_at_time NUMERIC(18, 4);
  v_current_stock NUMERIC(18, 4);
  v_total_batch_cost NUMERIC(18, 4) := 0;
  v_cost_per_unit NUMERIC(18, 4);
BEGIN
  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_produced must be greater than zero';
  END IF;

  IF p_materials IS NULL OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required for a production batch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM finished_products WHERE id = p_finished_product_id
  ) THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    IF v_material_id IS NULL OR v_quantity_used IS NULL OR v_quantity_used <= 0 THEN
      RAISE EXCEPTION 'Each material line requires material_id and quantity_used > 0';
    END IF;

    SELECT current_stock, average_cost_per_unit
    INTO v_current_stock, v_cost_at_time
    FROM raw_materials
    WHERE id = v_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Raw material % not found', v_material_id;
    END IF;

    IF v_current_stock < v_quantity_used THEN
      RAISE EXCEPTION 'Insufficient stock for material %. Available: %, required: %',
        v_material_id, v_current_stock, v_quantity_used;
    END IF;

    v_total_batch_cost := v_total_batch_cost + ROUND(v_quantity_used * v_cost_at_time, 4);
  END LOOP;

  v_cost_per_unit := ROUND(v_total_batch_cost / p_quantity_produced, 4);

  INSERT INTO production_batches (
    batch_number,
    production_date,
    finished_product_id,
    quantity_produced,
    cost_per_unit_produced,
    total_batch_cost,
    notes
  )
  VALUES (
    p_batch_number,
    p_production_date,
    p_finished_product_id,
    p_quantity_produced,
    v_cost_per_unit,
    v_total_batch_cost,
    p_notes
  )
  RETURNING id INTO v_batch_id;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    SELECT average_cost_per_unit
    INTO v_cost_at_time
    FROM raw_materials
    WHERE id = v_material_id;

    INSERT INTO production_batch_materials (
      batch_id,
      material_id,
      quantity_used,
      cost_at_time
    )
    VALUES (
      v_batch_id,
      v_material_id,
      v_quantity_used,
      v_cost_at_time
    );

    UPDATE raw_materials
    SET
      current_stock = current_stock - v_quantity_used,
      updated_at = now()
    WHERE id = v_material_id;
  END LOOP;

  UPDATE finished_products
  SET
    current_stock = current_stock + p_quantity_produced,
    updated_at = now()
  WHERE id = p_finished_product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    p_finished_product_id,
    'production_in',
    p_quantity_produced,
    v_batch_id,
    p_production_date,
    COALESCE(p_notes, 'Production batch ' || p_batch_number)
  );

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_raw_material_inventory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION recalculate_raw_material_inventory(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
