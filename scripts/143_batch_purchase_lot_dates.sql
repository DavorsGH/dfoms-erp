-- Script 143: Lot-level manufacturing & expiration dates on batches/purchases
--
-- Extends create_production_batch / create_product_purchase so optional
-- manufacturing_date and expiration_date can be stored on production_batches
-- and product_purchases (lot/batch level — not finished_products master).
--
-- Columns may already exist in some environments; ADD COLUMN IF NOT EXISTS
-- is safe to re-run. Apply on staging first.
--
-- NOTE: Postgres treats a changed argument list as a new overload. Drop the
-- prior signatures before recreating (same pattern as script 87).

BEGIN;

ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS manufacturing_date date,
  ADD COLUMN IF NOT EXISTS expiration_date date;

ALTER TABLE public.product_purchases
  ADD COLUMN IF NOT EXISTS manufacturing_date date,
  ADD COLUMN IF NOT EXISTS expiration_date date;

COMMENT ON COLUMN public.production_batches.manufacturing_date IS
  'Optional lot manufacturing date for this production batch.';

COMMENT ON COLUMN public.production_batches.expiration_date IS
  'Optional lot expiration date for this production batch.';

COMMENT ON COLUMN public.product_purchases.manufacturing_date IS
  'Optional lot manufacturing date for this product purchase.';

COMMENT ON COLUMN public.product_purchases.expiration_date IS
  'Optional lot expiration date for this product purchase.';

-- ---------------------------------------------------------------------------
-- create_production_batch — add optional lot dates
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_production_batch(
  text,
  date,
  uuid,
  numeric,
  text,
  jsonb
);

CREATE OR REPLACE FUNCTION public.create_production_batch(
  p_batch_number TEXT,
  p_production_date DATE,
  p_finished_product_id UUID,
  p_quantity_produced NUMERIC,
  p_notes TEXT,
  p_materials JSONB,
  p_manufacturing_date DATE DEFAULT NULL,
  p_expiration_date DATE DEFAULT NULL
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
    notes,
    manufacturing_date,
    expiration_date
  )
  VALUES (
    p_batch_number,
    p_production_date,
    p_finished_product_id,
    p_quantity_produced,
    v_cost_per_unit,
    v_total_batch_cost,
    p_notes,
    p_manufacturing_date,
    p_expiration_date
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

-- ---------------------------------------------------------------------------
-- create_product_purchase — add optional lot dates (based on script 92 body)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_product_purchase(
  date,
  uuid,
  numeric,
  numeric,
  uuid,
  text,
  text,
  uuid,
  uuid
);

CREATE OR REPLACE FUNCTION public.create_product_purchase(
  p_purchase_date DATE,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_cost_per_unit NUMERIC,
  p_supplier_id UUID,
  p_payment_method TEXT,
  p_notes TEXT,
  p_po_id UUID DEFAULT NULL,
  p_po_item_id UUID DEFAULT NULL,
  p_manufacturing_date DATE DEFAULT NULL,
  p_expiration_date DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase_id UUID;
  v_total_cost NUMERIC(18, 4);
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_supplier_name TEXT;
  v_product_name TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  SELECT product_name INTO v_product_name
  FROM finished_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = p_supplier_id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_cost_per_unit, 4);

  INSERT INTO product_purchases (
    product_id, purchase_date, quantity, cost_per_unit, total_cost,
    supplier_id, payment_method, notes, po_id, po_item_id,
    manufacturing_date, expiration_date
  )
  VALUES (
    p_product_id, p_purchase_date, p_quantity, p_cost_per_unit, v_total_cost,
    p_supplier_id, p_payment_method, p_notes, p_po_id, p_po_item_id,
    p_manufacturing_date, p_expiration_date
  )
  RETURNING id INTO v_purchase_id;

  UPDATE finished_products
  SET
    current_stock = current_stock + p_quantity,
    updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_id, movement_date, notes
  )
  VALUES (
    p_product_id,
    'purchase_in',
    p_quantity,
    v_purchase_id,
    p_purchase_date,
    COALESCE(
      NULLIF(TRIM(p_notes), ''),
      'Product purchase from ' || COALESCE(v_supplier_name, 'supplier')
    )
  );

  -- Only credit purchases create a payable — cash/POS/MoMo purchases are
  -- paid immediately and owe nothing. Reuses the same heuristic already
  -- used for raw material purchases (is_credit_payment_method).
  IF is_credit_payment_method(p_payment_method) THEN
    v_invoice_no := 'PPU-' || LEFT(v_purchase_id::TEXT, 8);

    INSERT INTO accounts_payable (
      vendor_name, invoice_number, expense_category, sub_category, description,
      invoice_date, due_date, amount, amount_paid, balance_due, status, notes
    )
    VALUES (
      COALESCE(NULLIF(TRIM(v_supplier_name), ''), 'Product Supplier'),
      v_invoice_no,
      'Direct Operational',
      'Product Purchases',
      'Purchase of ' || v_product_name || ' posted to inventory',
      p_purchase_date,
      p_purchase_date + INTERVAL '30 days',
      v_total_cost,
      0,
      v_total_cost,
      'Outstanding',
      'Linked to product_purchases ' || v_purchase_id::TEXT
    )
    RETURNING id INTO v_payable_id;

    UPDATE product_purchases
    SET accounts_payable_id = v_payable_id
    WHERE id = v_purchase_id;
  END IF;

  RETURN v_purchase_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_production_batch(
  text, date, uuid, numeric, text, jsonb, date, date
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_product_purchase(
  date, uuid, numeric, numeric, uuid, text, text, uuid, uuid, date, date
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
