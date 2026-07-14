-- Script 43: Safe void/reversal for product sales
-- Marks sale as voided, restores stock, appends reversal stock_movement,
-- and posts a negative COGS expense reversal (original rows kept for audit).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_sale_status') THEN
    CREATE TYPE product_sale_status AS ENUM ('active', 'voided');
  END IF;
END $$;

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS sale_status product_sale_status NOT NULL DEFAULT 'active';

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS cogs_reversal_expense_id UUID REFERENCES expense_register (id);

CREATE OR REPLACE FUNCTION void_product_sale(p_income_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale income_register%ROWTYPE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_reversal_expense_id UUID;
  v_reversal_receipt_no TEXT;
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
  END IF;

  UPDATE finished_products
  SET
    current_stock = current_stock + v_sale.sale_quantity,
    updated_at = now()
  WHERE id = v_sale.product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
  )
  VALUES (
    v_sale.product_id,
    'adjustment',
    v_sale.sale_quantity,
    v_sale.id,
    COALESCE(v_sale.date, CURRENT_DATE),
    'Reversal of voided sale ' || v_sale.invoice_no
  );

  IF v_sale.cogs_expense_id IS NOT NULL AND v_cogs_amount <> 0 THEN
    v_reversal_receipt_no := 'VOID-COGS-' || TRIM(v_sale.invoice_no);

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
      CURRENT_DATE,
      'Cost of Goods Sold',
      'Product Sales',
      'COGS reversal for voided product sale ' || v_sale.invoice_no || ' (' || v_product_name || ')',
      'Internal',
      -ABS(v_cogs_unit_cost),
      v_sale.sale_quantity,
      -ABS(v_cogs_amount),
      'Internal',
      'System',
      v_reversal_receipt_no,
      'Paid',
      'Reversal of expense_register ' || v_sale.cogs_expense_id::TEXT
        || ' linked to voided income_register ' || v_sale.id::TEXT
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
$$;

GRANT EXECUTE ON FUNCTION void_product_sale(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION void_product_sale(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
