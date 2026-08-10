-- Script 200: Product purchase edit RPC
-- Mirrors update_raw_material_purchase (script 45): adjust stock ledger, stock_movements,
-- and linked accounts payable in place. Product cannot be changed on edit.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_product_purchase_payable(
  p_purchase_id UUID,
  p_product_id UUID,
  p_purchase_date DATE,
  p_supplier_name TEXT,
  p_total_cost NUMERIC(18, 4)
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_product_name TEXT;
BEGIN
  SELECT product_name
  INTO v_product_name
  FROM finished_products
  WHERE id = p_product_id;

  v_invoice_no := 'PPU-' || LEFT(p_purchase_id::TEXT, 8);

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
    COALESCE(NULLIF(TRIM(p_supplier_name), ''), 'Product Supplier'),
    v_invoice_no,
    'Direct Operational',
    'Product Purchases',
    'Purchase of ' || COALESCE(v_product_name, 'product') || ' posted to inventory',
    p_purchase_date,
    p_purchase_date + INTERVAL '30 days',
    p_total_cost,
    0,
    p_total_cost,
    'Outstanding',
    'Linked to product_purchases ' || p_purchase_id::TEXT
  )
  RETURNING id INTO v_payable_id;

  UPDATE product_purchases
  SET accounts_payable_id = v_payable_id
  WHERE id = p_purchase_id;

  RETURN v_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_product_purchase_payable(
  p_purchase_id UUID,
  p_product_id UUID,
  p_purchase_date DATE,
  p_supplier_name TEXT,
  p_payment_method TEXT,
  p_total_cost NUMERIC(18, 4),
  p_existing_payable_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_new_credit BOOLEAN;
  v_amount_paid NUMERIC(18, 4);
BEGIN
  v_new_credit := is_credit_payment_method(p_payment_method);

  IF NOT v_new_credit THEN
    PERFORM reverse_raw_material_purchase_payable(p_existing_payable_id);
    UPDATE product_purchases
    SET accounts_payable_id = NULL
    WHERE id = p_purchase_id;
    RETURN;
  END IF;

  IF p_existing_payable_id IS NULL THEN
    PERFORM create_product_purchase_payable(
      p_purchase_id,
      p_product_id,
      p_purchase_date,
      p_supplier_name,
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
    vendor_name = COALESCE(NULLIF(TRIM(p_supplier_name), ''), 'Product Supplier'),
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

CREATE OR REPLACE FUNCTION public.update_product_purchase(
  p_purchase_id UUID,
  p_purchase_date DATE,
  p_quantity NUMERIC(18, 4),
  p_cost_per_unit NUMERIC(18, 4),
  p_supplier_id UUID,
  p_payment_method TEXT,
  p_notes TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase product_purchases%ROWTYPE;
  v_total_cost NUMERIC(18, 4);
  v_supplier_name TEXT;
  v_qty_delta NUMERIC(18, 4);
  v_current_stock NUMERIC(18, 4);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  IF p_payment_method IS NULL OR TRIM(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for product purchases';
  END IF;

  SELECT *
  INTO v_purchase
  FROM product_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product purchase % not found', p_purchase_id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_cost_per_unit, 4);
  v_qty_delta := p_quantity - v_purchase.quantity;

  IF v_qty_delta <> 0 THEN
    SELECT current_stock
    INTO v_current_stock
    FROM finished_products
    WHERE id = v_purchase.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Finished product not found';
    END IF;

    IF v_current_stock + v_qty_delta < 0 THEN
      RAISE EXCEPTION
        'Cannot save changes — only % in stock after adjusting this purchase',
        TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_current_stock::TEXT));
    END IF;

    UPDATE finished_products
    SET
      current_stock = current_stock + v_qty_delta,
      updated_at = now()
    WHERE id = v_purchase.product_id;

    UPDATE stock_movements
    SET
      quantity = p_quantity,
      movement_date = p_purchase_date,
      notes = COALESCE(
        NULLIF(TRIM(p_notes), ''),
        notes
      )
    WHERE reference_id = p_purchase_id
      AND movement_type = 'purchase_in'
      AND product_id = v_purchase.product_id;
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = p_supplier_id;
  END IF;

  PERFORM sync_product_purchase_payable(
    p_purchase_id,
    v_purchase.product_id,
    p_purchase_date,
    v_supplier_name,
    p_payment_method,
    v_total_cost,
    v_purchase.accounts_payable_id
  );

  UPDATE product_purchases
  SET
    purchase_date = p_purchase_date,
    quantity = p_quantity,
    cost_per_unit = p_cost_per_unit,
    total_cost = v_total_cost,
    supplier_id = p_supplier_id,
    payment_method = TRIM(p_payment_method),
    notes = NULLIF(TRIM(p_notes), '')
  WHERE id = p_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_purchase_payable(
  UUID, UUID, DATE, TEXT, NUMERIC
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.sync_product_purchase_payable(
  UUID, UUID, DATE, TEXT, TEXT, NUMERIC, UUID
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_product_purchase(
  UUID, DATE, NUMERIC, NUMERIC, UUID, TEXT, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.update_product_purchase(
  UUID, DATE, NUMERIC, NUMERIC, UUID, TEXT, TEXT
) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
