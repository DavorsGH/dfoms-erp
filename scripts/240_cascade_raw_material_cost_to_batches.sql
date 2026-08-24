-- Script 240: Cascade raw-material purchase cost corrections into production batches
--
-- Platform-wide. Staging first.
--
-- When a raw material purchase is edited or deleted, recalculate_raw_material_inventory
-- already rebuilds raw_materials.average_cost_per_unit using the LIFETIME purchase WAC:
--   Σ(qty × cost_per_unit) / Σ(qty)
-- (same identity as month-aware Balance Sheet RM valuation).
--
-- Previously that stopped at the RM master row. Production batch costs stayed locked
-- at the perpetual/moving average snapshotted at production time, so finished-product
-- on-hand WAC (script 145) and month-aware BS inventory did not absorb the correction
-- for unsold manufactured stock.
--
-- This script:
--   1. Adds cascade_raw_material_cost_to_batches(material_id) which:
--        - computes lifetime WAC explicitly (identical formula to
--          recalculate_raw_material_inventory / BS)
--        - rewrites production_batch_materials.cost_at_time for EVERY historical
--          consumption of that material
--        - rebuilds production_batches.total_batch_cost and cost_per_unit_produced
--          for every affected batch from ALL material lines on the batch
--   2. Calls the cascade from update_raw_material_purchase and
--      delete_raw_material_purchase AFTER recalculate_raw_material_inventory,
--      inside the same RPC transaction (atomic).
--
-- Does NOT touch expense_register / income_register COGS. Sold units keep locked
-- COGS; remaining stock absorbs the correction via the existing
-- finished_product_weighted_avg_cost (145) identity:
--   (Σ batch totals + purchases − booked COGS) / current_stock

BEGIN;

-- ---------------------------------------------------------------------------
-- Cascade helper: lifetime WAC → all historical batches that used this material
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cascade_raw_material_cost_to_batches(
  p_material_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
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

  -- Lifetime purchase WAC — identical to recalculate_raw_material_inventory
  -- and calculateRawMaterialValueAsOf (month-aware BS). NOT the perpetual
  -- moving-average identity used by apply_raw_material_purchase on INSERT.
  SELECT
    COALESCE(SUM(quantity), 0),
    COALESCE(SUM(ROUND(quantity * cost_per_unit, 4)), 0)
  INTO v_purchased_qty, v_purchased_value
  FROM raw_material_purchases
  WHERE material_id = p_material_id;

  IF v_purchased_qty > 0 THEN
    v_lifetime_wac := ROUND(v_purchased_value / v_purchased_qty, 4);
  ELSE
    v_lifetime_wac := 0;
  END IF;

  UPDATE production_batch_materials
  SET cost_at_time = v_lifetime_wac
  WHERE material_id = p_material_id
    AND cost_at_time IS DISTINCT FROM v_lifetime_wac;

  FOR v_batch_id IN
    SELECT DISTINCT batch_id
    FROM production_batch_materials
    WHERE material_id = p_material_id
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
$$;

COMMENT ON FUNCTION public.cascade_raw_material_cost_to_batches(UUID) IS
  'After RM purchase edit/delete: rewrite cost_at_time on all historical '
  'production_batch_materials for this material using lifetime purchase WAC '
  '(Σ qty×cost / Σ qty), then rebuild parent batch totals. Does not touch COGS.';

-- ---------------------------------------------------------------------------
-- Update purchase: existing body + cascade after recalculate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_raw_material_purchase(
  p_purchase_id UUID,
  p_purchase_date DATE,
  p_quantity NUMERIC(18, 4),
  p_cost_per_unit NUMERIC(18, 4),
  p_supplier TEXT,
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
  v_total_cost NUMERIC(18, 4);
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

  -- Atomic with this RPC: RM WAC first, then cascade into all historical batches.
  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);
  PERFORM cascade_raw_material_cost_to_batches(v_purchase.material_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Delete purchase: existing body + cascade after recalculate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_raw_material_purchase(p_purchase_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase raw_material_purchases%ROWTYPE;
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
  PERFORM cascade_raw_material_cost_to_batches(v_purchase.material_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cascade_raw_material_cost_to_batches(UUID)
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.update_raw_material_purchase(
  UUID, DATE, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_raw_material_purchase(UUID)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
