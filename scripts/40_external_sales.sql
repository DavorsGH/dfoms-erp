-- Script 40: Sales & Inventory Phase 3 — external product sales via Income Register
-- Adds product sale entry type, stock decrement, sale_out ledger, and auto COGS expense.

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum: income register entry types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'income_entry_type') THEN
    CREATE TYPE income_entry_type AS ENUM ('service', 'product_sale');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Extend income_register for product sales
-- ---------------------------------------------------------------------------
ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS entry_type income_entry_type NOT NULL DEFAULT 'service';

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES finished_products (id);

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS sale_quantity NUMERIC(18, 4);

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(18, 4);

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS cogs_expense_id UUID REFERENCES expense_register (id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'income_register'
      AND column_name = 'service_category'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE income_register
      ALTER COLUMN service_category DROP NOT NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. RPC: create product sale atomically
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_product_sale(
  p_date DATE,
  p_invoice_no TEXT,
  p_client_id TEXT,
  p_customer_name TEXT,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_unit_price NUMERIC,
  p_amount_received NUMERIC,
  p_payment_status TEXT,
  p_due_date DATE,
  p_description TEXT,
  p_notes TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_income_id UUID;
  v_expense_id UUID;
  v_current_stock NUMERIC(18, 4);
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_amount NUMERIC(18, 4);
  v_outstanding NUMERIC(18, 4);
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_receipt_no TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater';
  END IF;

  IF p_client_id IS NULL AND (p_customer_name IS NULL OR TRIM(p_customer_name) = '') THEN
    RAISE EXCEPTION 'Select a contract client or enter an other payer name';
  END IF;

  SELECT current_stock, product_name, unit_of_measure
  INTO v_current_stock, v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  IF v_current_stock < p_quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot sell %',
      v_current_stock,
      v_unit_of_measure,
      v_product_name,
      p_quantity;
  END IF;

  v_amount := ROUND(p_quantity * p_unit_price, 4);
  v_outstanding := ROUND(v_amount - COALESCE(p_amount_received, 0), 4);

  SELECT COALESCE(
    ROUND(SUM(total_batch_cost) / NULLIF(SUM(quantity_produced), 0), 4),
    0
  )
  INTO v_cogs_unit_cost
  FROM production_batches
  WHERE finished_product_id = p_product_id;

  v_cogs_amount := ROUND(v_cogs_unit_cost * p_quantity, 4);
  v_cogs_receipt_no := 'COGS-' || TRIM(p_invoice_no);

  INSERT INTO income_register (
    date,
    invoice_no,
    client_id,
    customer_name,
    entry_type,
    service_category,
    description,
    amount,
    amount_received,
    outstanding_balance,
    payment_status,
    due_date,
    notes,
    product_id,
    sale_quantity,
    unit_price
  )
  VALUES (
    p_date,
    p_invoice_no,
    p_client_id,
    CASE WHEN p_client_id IS NULL THEN NULLIF(TRIM(p_customer_name), '') ELSE NULL END,
    'product_sale',
    NULL,
    COALESCE(
      NULLIF(TRIM(p_description), ''),
      'Product sale: ' || v_product_name || ' x ' || p_quantity || ' ' || v_unit_of_measure
    ),
    v_amount,
    COALESCE(p_amount_received, 0),
    v_outstanding,
    p_payment_status,
    p_due_date,
    p_notes,
    p_product_id,
    p_quantity,
    p_unit_price
  )
  RETURNING id INTO v_income_id;

  UPDATE finished_products
  SET
    current_stock = current_stock - p_quantity,
    updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    p_product_id,
    'sale_out',
    p_quantity,
    v_income_id,
    p_date,
    COALESCE(
      NULLIF(TRIM(p_notes), ''),
      'Product sale invoice ' || p_invoice_no
    )
  );

  INSERT INTO expense_register (
    date,
    expense_category,
    sub_category,
    description,
    vendor,
    price,
    quantity,
    amount,
    payment_method,
    approved_by,
    receipt_no,
    payment_status,
    notes
  )
  VALUES (
    p_date,
    'Cost of Goods Sold',
    'Product Sales',
    'Auto-posted COGS for product sale ' || p_invoice_no || ' (' || v_product_name || ')',
    'Internal',
    v_cogs_unit_cost,
    p_quantity,
    v_cogs_amount,
    'Internal',
    'System',
    v_cogs_receipt_no,
    'Paid',
    'Linked to income_register ' || v_income_id::TEXT
  )
  RETURNING id INTO v_expense_id;

  UPDATE income_register
  SET cogs_expense_id = v_expense_id
  WHERE id = v_income_id;

  RETURN v_income_id;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
