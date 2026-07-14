BEGIN;
-- 5. Cascade delete preview + execute — raw materials
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preview_raw_material_delete(p_material_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_name TEXT;
  v_purchase_count INTEGER := 0;
  v_batch_material_count INTEGER := 0;
  v_incomplete_batches JSONB := '[]'::JSONB;
BEGIN
  SELECT material_name
  INTO v_name
  FROM raw_materials
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  SELECT COUNT(*)
  INTO v_purchase_count
  FROM raw_material_purchases
  WHERE material_id = p_material_id;

  SELECT COUNT(*)
  INTO v_batch_material_count
  FROM production_batch_materials
  WHERE material_id = p_material_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'batch_number', pb.batch_number,
        'remaining_material_count', other_materials.cnt - 1
      )
      ORDER BY pb.batch_number
    ),
    '[]'::JSONB
  )
  INTO v_incomplete_batches
  FROM production_batch_materials pbm
  JOIN production_batches pb ON pb.id = pbm.batch_id
  JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS cnt
    FROM production_batch_materials x
    WHERE x.batch_id = pbm.batch_id
  ) other_materials ON TRUE
  WHERE pbm.material_id = p_material_id
    AND other_materials.cnt = 1;

  RETURN jsonb_build_object(
    'material_name', v_name,
    'purchase_count', v_purchase_count,
    'batch_material_count', v_batch_material_count,
    'incomplete_batches', v_incomplete_batches
  );
END;
$$;

CREATE OR REPLACE FUNCTION delete_raw_material_cascade(p_material_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM raw_materials WHERE id = p_material_id) THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  FOR v_purchase IN
    SELECT id, accounts_payable_id
    FROM raw_material_purchases
    WHERE material_id = p_material_id
    ORDER BY created_at, id
  LOOP
    PERFORM reverse_raw_material_purchase_payable(v_purchase.accounts_payable_id);
    DELETE FROM raw_material_purchases
    WHERE id = v_purchase.id;
  END LOOP;

  DELETE FROM production_batch_materials
  WHERE material_id = p_material_id;

  DELETE FROM raw_materials
  WHERE id = p_material_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cascade delete preview + execute — finished products
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION preview_finished_product_delete(p_product_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_name TEXT;
  v_sale_count INTEGER := 0;
  v_consumption_count INTEGER := 0;
  v_stock_movement_count INTEGER := 0;
  v_batch_count INTEGER := 0;
BEGIN
  SELECT product_name
  INTO v_name
  FROM finished_products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;

  SELECT COUNT(*)
  INTO v_sale_count
  FROM income_register
  WHERE product_id = p_product_id
    AND entry_type = 'product_sale';

  SELECT COUNT(*)
  INTO v_consumption_count
  FROM internal_consumption
  WHERE product_id = p_product_id;

  SELECT COUNT(*)
  INTO v_stock_movement_count
  FROM stock_movements
  WHERE product_id = p_product_id;

  SELECT COUNT(*)
  INTO v_batch_count
  FROM production_batches
  WHERE finished_product_id = p_product_id;

  RETURN jsonb_build_object(
    'product_name', v_name,
    'sale_count', v_sale_count,
    'consumption_count', v_consumption_count,
    'stock_movement_count', v_stock_movement_count,
    'batch_count', v_batch_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION delete_finished_product_cascade(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale RECORD;
  v_consumption RECORD;
  v_batch RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finished_products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;

  FOR v_sale IN
    SELECT id, sale_status
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
    ORDER BY date, id
  LOOP
    IF v_sale.sale_status IS DISTINCT FROM 'voided' THEN
      PERFORM void_product_sale(v_sale.id);
    END IF;
  END LOOP;

  FOR v_sale IN
    SELECT id, cogs_expense_id, cogs_reversal_expense_id
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
  LOOP
    IF v_sale.cogs_reversal_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_reversal_expense_id;
    END IF;
    IF v_sale.cogs_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_expense_id;
    END IF;
    DELETE FROM stock_movements
    WHERE reference_id = v_sale.id;
    DELETE FROM income_register WHERE id = v_sale.id;
  END LOOP;

  FOR v_consumption IN
    SELECT id, expense_register_id, quantity
    FROM internal_consumption
    WHERE product_id = p_product_id
    ORDER BY consumption_date, id
  LOOP
    IF v_consumption.expense_register_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_consumption.expense_register_id;
    END IF;
    DELETE FROM stock_movements WHERE reference_id = v_consumption.id;
    DELETE FROM internal_consumption WHERE id = v_consumption.id;
  END LOOP;

  FOR v_batch IN
    SELECT id
    FROM production_batches
    WHERE finished_product_id = p_product_id
    ORDER BY production_date, id
  LOOP
    DELETE FROM production_batch_materials WHERE batch_id = v_batch.id;
    DELETE FROM stock_movements WHERE reference_id = v_batch.id;
    DELETE FROM production_batches WHERE id = v_batch.id;
  END LOOP;

  DELETE FROM stock_movements WHERE product_id = p_product_id;
  DELETE FROM finished_products WHERE id = p_product_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION delete_raw_material_purchase(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_raw_material_purchase(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION update_raw_material_purchase(UUID, DATE, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_raw_material_purchase(UUID, DATE, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION preview_raw_material_delete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_raw_material_delete(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION delete_raw_material_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_raw_material_cascade(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION preview_finished_product_delete(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION preview_finished_product_delete(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION delete_finished_product_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_finished_product_cascade(UUID) TO service_role;
COMMIT;
NOTIFY pgrst, 'reload schema';
