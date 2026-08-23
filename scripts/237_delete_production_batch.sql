-- Script 237: delete_production_batch (+ preview)
--
-- Reverses create_production_batch for the delete-and-recreate correction
-- convention (same idea as delete_product_purchase).
--
-- create_production_batch effects (no finance postings):
--   1. Insert production_batches + production_batch_materials
--   2. Decrement raw_materials.current_stock per line
--   3. Increment finished_products.current_stock
--   4. Insert stock_movements (movement_type = 'production_in', reference_id = batch id)
--
-- delete_production_batch reverses those steps and re-runs
-- recalculate_raw_material_inventory for each consumed material so average
-- cost matches purchases − remaining consumption.
--
-- COGS: historical product_sale COGS rows are left alone. Future COGS and
-- Balance Sheet valuation use finished_product_weighted_avg_cost /
-- get_finished_product_average_costs, which read production_batches and
-- finished_products.current_stock live — deletion flows through automatically.
--
-- Apply on STAGING first. Do not apply to production until verified.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preview: can this batch be deleted?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_delete_production_batch(p_batch_id uuid)
RETURNS TABLE (
  can_delete boolean,
  block_reason text,
  batch_number text,
  quantity_produced numeric,
  product_id uuid,
  product_current_stock numeric,
  material_line_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_stock NUMERIC(18, 4);
  v_lines BIGINT;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id
    AND tenant_id = public.current_user_tenant_id();

  IF NOT FOUND THEN
    can_delete := false;
    block_reason := 'Production batch not found.';
    batch_number := NULL;
    quantity_produced := NULL;
    product_id := NULL;
    product_current_stock := NULL;
    material_line_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT fp.current_stock
  INTO v_stock
  FROM public.finished_products fp
  WHERE fp.id = v_batch.finished_product_id
    AND fp.tenant_id = v_batch.tenant_id;

  SELECT COUNT(*)::BIGINT
  INTO v_lines
  FROM public.production_batch_materials
  WHERE batch_id = v_batch.id;

  batch_number := v_batch.batch_number;
  quantity_produced := v_batch.quantity_produced;
  product_id := v_batch.finished_product_id;
  product_current_stock := COALESCE(v_stock, 0);
  material_line_count := v_lines;

  IF COALESCE(v_stock, 0) < v_batch.quantity_produced THEN
    can_delete := false;
    block_reason := format(
      'Cannot delete this batch — only %s units of the finished product remain in stock, but deleting it would remove %s units (some of this batch has likely already been sold or consumed).',
      trim(trailing '.' from trim(trailing '0' from COALESCE(v_stock, 0)::text)),
      trim(trailing '.' from trim(trailing '0' from v_batch.quantity_produced::text))
    );
  ELSE
    can_delete := true;
    block_reason := NULL;
  END IF;

  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.preview_delete_production_batch(uuid) IS
  'Preview whether a production batch can be deleted; blocks when finished stock is below batch quantity.';

-- ---------------------------------------------------------------------------
-- Delete: reverse create_production_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_production_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_stock NUMERIC(18, 4);
  v_material_id UUID;
  v_material_ids UUID[];
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id
    AND tenant_id = public.current_user_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production batch not found.';
  END IF;

  SELECT fp.current_stock
  INTO v_stock
  FROM public.finished_products fp
  WHERE fp.id = v_batch.finished_product_id
    AND fp.tenant_id = v_batch.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found for this batch.';
  END IF;

  IF COALESCE(v_stock, 0) < v_batch.quantity_produced THEN
    RAISE EXCEPTION
      'Cannot delete this batch — only % units of the finished product remain in stock, but deleting it would remove % units (some of this batch has likely already been sold or consumed).',
      trim(trailing '.' from trim(trailing '0' from COALESCE(v_stock, 0)::text)),
      trim(trailing '.' from trim(trailing '0' from v_batch.quantity_produced::text));
  END IF;

  SELECT COALESCE(array_agg(DISTINCT material_id), ARRAY[]::UUID[])
  INTO v_material_ids
  FROM public.production_batch_materials
  WHERE batch_id = v_batch.id;

  -- Remove the production_in ledger row for this batch.
  DELETE FROM public.stock_movements
  WHERE reference_id = v_batch.id
    AND movement_type = 'production_in';

  -- Reverse finished-product stock increment from create.
  UPDATE public.finished_products
  SET
    current_stock = current_stock - v_batch.quantity_produced,
    updated_at = now()
  WHERE id = v_batch.finished_product_id
    AND tenant_id = v_batch.tenant_id;

  -- Cascade deletes production_batch_materials; delete batch explicitly.
  DELETE FROM public.production_batches
  WHERE id = v_batch.id
    AND tenant_id = v_batch.tenant_id;

  -- Rebuild raw material stock + average cost from purchases − remaining consumption.
  IF v_material_ids IS NOT NULL THEN
    FOREACH v_material_id IN ARRAY v_material_ids
    LOOP
      PERFORM public.recalculate_raw_material_inventory(v_material_id);
    END LOOP;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.delete_production_batch(uuid) IS
  'Delete a production batch and reverse stock / materials / stock_movements. Blocks when finished stock is insufficient.';

REVOKE ALL ON FUNCTION public.preview_delete_production_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_delete_production_batch(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.delete_production_batch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_production_batch(uuid)
  TO authenticated, service_role;

COMMIT;
