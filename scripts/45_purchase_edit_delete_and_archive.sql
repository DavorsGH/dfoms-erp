-- Script 45: Raw material purchase edit/delete + archive for raw materials & finished products.
-- Purchase changes replay inventory from ledger; finance postings are adjusted in place.
-- Archived items stay in master lists (optional filter) but drop out of active dropdowns.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Archive columns
-- ---------------------------------------------------------------------------
ALTER TABLE raw_materials
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE finished_products
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 2. Stock validation helper (preview purchases minus batch consumption)
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
-- 3. Reverse or adjust Accounts Payable for a purchase
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
  v_payable_id UUID;
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
-- 4. Delete raw material purchase (recalc + reverse finance)
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

-- ---------------------------------------------------------------------------
-- 5. Update raw material purchase (recalc + adjust finance; snapshots unchanged)
-- ---------------------------------------------------------------------------
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
-- 6. Archive helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION archive_raw_material(p_material_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE raw_materials
  SET
    is_archived = true,
    updated_at = now()
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION archive_finished_product(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE finished_products
  SET
    is_archived = true,
    updated_at = now()
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_raw_material_purchase(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_raw_material_purchase(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION update_raw_material_purchase(
  UUID, DATE, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION update_raw_material_purchase(
  UUID, DATE, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO service_role;

GRANT EXECUTE ON FUNCTION archive_raw_material(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_raw_material(UUID) TO service_role;

GRANT EXECUTE ON FUNCTION archive_finished_product(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION archive_finished_product(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
