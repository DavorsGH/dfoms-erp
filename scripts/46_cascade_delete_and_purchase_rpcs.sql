-- Script 46: Apply purchase edit/delete RPCs + cascade delete for raw materials & finished products.
-- Includes Script 45 purchase/finance helpers. Archive columns kept for compatibility but unused in UI.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Drop legacy RPCs whose return type/signature changed in this script
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS delete_raw_material_purchase(UUID);

-- ---------------------------------------------------------------------------
-- 1. Optional archive columns (harmless if already present)
-- ---------------------------------------------------------------------------
ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE finished_products
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Stock validation helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_raw_material_stock_not_negative(
  p_material_id UUID,
  p_exclude_purchase_id UUID DEFAULT NULL,
  p_override_purchase_id UUID DEFAULT NULL,
  p_override_quantity NUMERIC(18, 4) DEFAULT NULL,
  p_action TEXT DEFAULT 'delete'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchased_qty NUMERIC(18, 4) := 0;
  v_consumed_qty NUMERIC(18, 4) := 0;
  v_unit TEXT;
  v_purchase RECORD;
  v_action_label TEXT;
BEGIN
  FOR v_purchase IN
    SELECT id, quantity
    FROM raw_material_purchases
    WHERE material_id = p_material_id
      AND (p_exclude_purchase_id IS NULL OR id <> p_exclude_purchase_id)
  LOOP
    IF p_override_purchase_id IS NOT NULL AND v_purchase.id = p_override_purchase_id THEN
      v_purchased_qty := v_purchased_qty + COALESCE(p_override_quantity, v_purchase.quantity);
    ELSE
      v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    END IF;
  END LOOP;

  SELECT COALESCE(SUM(quantity_used), 0)
  INTO v_consumed_qty
  FROM production_batch_materials
  WHERE material_id = p_material_id;

  IF v_purchased_qty - v_consumed_qty < 0 THEN
    SELECT unit_of_measure
    INTO v_unit
    FROM raw_materials
    WHERE id = p_material_id;

    v_action_label := CASE
      WHEN lower(trim(p_action)) IN ('update', 'edit', 'save') THEN 'save changes to this purchase'
      ELSE 'delete'
    END;

    RAISE EXCEPTION
      'Cannot % — % of this material has already been used in production, but remaining purchases only total %',
      v_action_label,
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_consumed_qty::TEXT)) || COALESCE(v_unit, ''),
      TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_purchased_qty::TEXT)) || COALESCE(v_unit, '');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Finance helpers for purchases
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_raw_material_purchase_payable(p_payable_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_payable_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM accounts_payable
    WHERE id = p_payable_id
      AND COALESCE(amount_paid, 0) > 0
  ) THEN
    RAISE EXCEPTION
      'Cannot reverse accounts payable — partial or full payment has already been recorded';
  END IF;

  DELETE FROM accounts_payable
  WHERE id = p_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION create_raw_material_purchase_payable(
  p_purchase_id UUID,
  p_material_id UUID,
  p_purchase_date DATE,
  p_supplier TEXT,
  p_total_cost NUMERIC(18, 4)
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
BEGIN
  v_invoice_no := 'RMP-' || LEFT(p_purchase_id::TEXT, 8);

  INSERT INTO accounts_payable (
    vendor_name,
    invoice_number,
    expense_category,
    sub_category,
    description,
    invoice_date,
    due_date,
    amount,
    amount_paid,
    balance_due,
    status,
    notes
  )
  VALUES (
    COALESCE(NULLIF(TRIM(p_supplier), ''), 'Raw Material Supplier'),
    v_invoice_no,
    'Direct Operational',
    'Raw Materials',
    'Raw material purchase posted to inventory',
    p_purchase_date,
    p_purchase_date + INTERVAL '30 days',
    p_total_cost,
    0,
    p_total_cost,
    'Outstanding',
    'Linked to raw_material_purchases ' || p_purchase_id::TEXT
  )
  RETURNING id INTO v_payable_id;

  UPDATE raw_material_purchases
  SET accounts_payable_id = v_payable_id
  WHERE id = p_purchase_id;

  RETURN v_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_raw_material_purchase_payable(
  p_purchase_id UUID,
  p_material_id UUID,
  p_purchase_date DATE,
  p_supplier TEXT,
  p_payment_method TEXT,
  p_total_cost NUMERIC(18, 4),
  p_existing_payable_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_go_live DATE;
  v_should_post BOOLEAN;
  v_new_credit BOOLEAN;
  v_amount_paid NUMERIC(18, 4);
BEGIN
  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  v_should_post := v_go_live IS NOT NULL AND p_purchase_date >= v_go_live;
  v_new_credit := is_credit_payment_method(p_payment_method);

  IF NOT v_should_post OR NOT v_new_credit THEN
    PERFORM reverse_raw_material_purchase_payable(p_existing_payable_id);
    UPDATE raw_material_purchases
    SET accounts_payable_id = NULL
    WHERE id = p_purchase_id;
    RETURN;
  END IF;

  IF p_existing_payable_id IS NULL THEN
    PERFORM create_raw_material_purchase_payable(
      p_purchase_id,
      p_material_id,
      p_purchase_date,
      p_supplier,
      p_total_cost
    );
    RETURN;
  END IF;

  SELECT COALESCE(amount_paid, 0)
  INTO v_amount_paid
  FROM accounts_payable
  WHERE id = p_existing_payable_id;

  IF v_amount_paid > p_total_cost THEN
    RAISE EXCEPTION
      'Cannot reduce purchase total below amount already paid on accounts payable (GHS %)',
      v_amount_paid;
  END IF;

  UPDATE accounts_payable
  SET
    vendor_name = COALESCE(NULLIF(TRIM(p_supplier), ''), 'Raw Material Supplier'),
    invoice_date = p_purchase_date,
    due_date = p_purchase_date + INTERVAL '30 days',
    amount = p_total_cost,
    balance_due = p_total_cost - v_amount_paid,
    status = CASE
      WHEN v_amount_paid >= p_total_cost THEN 'Paid'
      WHEN v_amount_paid > 0 THEN 'Partial'
      ELSE 'Outstanding'
    END
  WHERE id = p_existing_payable_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Purchase edit/delete RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_raw_material_purchase(p_purchase_id UUID)
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
END;
$$;

CREATE OR REPLACE FUNCTION update_raw_material_purchase(
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

  PERFORM recalculate_raw_material_inventory(v_purchase.material_id);
END;
$$;

-- ---------------------------------------------------------------------------
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
