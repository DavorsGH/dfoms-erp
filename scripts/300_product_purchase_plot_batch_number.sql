-- Script 300: Require plot/lot batch_number on product_purchases create
--
-- product_purchases.batch_number is NOT NULL (script 173). The app allocates
-- via generate_next_code(tenant_id, 'PLOT', 4) and passes p_batch_number here.
-- Apply on staging first.

BEGIN;

DROP FUNCTION IF EXISTS public.create_product_purchase(
  date,
  uuid,
  numeric,
  numeric,
  uuid,
  text,
  text,
  uuid,
  uuid,
  date,
  date,
  uuid
);

CREATE OR REPLACE FUNCTION public.create_product_purchase(
  p_purchase_date date,
  p_product_id uuid,
  p_quantity numeric,
  p_cost_per_unit numeric,
  p_supplier_id uuid,
  p_payment_method text,
  p_notes text,
  p_batch_number text,
  p_po_id uuid DEFAULT NULL::uuid,
  p_po_item_id uuid DEFAULT NULL::uuid,
  p_manufacturing_date date DEFAULT NULL::date,
  p_expiration_date date DEFAULT NULL::date,
  p_business_unit_id uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase_id UUID;
  v_total_cost NUMERIC(18, 4);
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_supplier_name TEXT;
  v_product_name TEXT;
  v_product_tenant_id UUID;
  v_business_unit_id UUID := p_business_unit_id;
BEGIN
  PERFORM public.assert_not_view_all_business_units();

  IF p_batch_number IS NULL OR TRIM(p_batch_number) = '' THEN
    RAISE EXCEPTION 'batch_number is required';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  IF v_business_unit_id IS NULL AND p_po_id IS NOT NULL THEN
    SELECT business_unit_id INTO v_business_unit_id
    FROM purchase_orders
    WHERE id = p_po_id;
  END IF;

  SELECT product_name, tenant_id
  INTO v_product_name, v_product_tenant_id
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
    manufacturing_date, expiration_date, business_unit_id, batch_number
  )
  VALUES (
    p_product_id, p_purchase_date, p_quantity, p_cost_per_unit, v_total_cost,
    p_supplier_id, p_payment_method, p_notes, p_po_id, p_po_item_id,
    p_manufacturing_date, p_expiration_date, v_business_unit_id, TRIM(p_batch_number)
  )
  RETURNING id INTO v_purchase_id;

  UPDATE finished_products
  SET current_stock = current_stock + p_quantity, updated_at = now()
  WHERE id = p_product_id;

  PERFORM public.adjust_finished_product_balance_qty(
    v_product_tenant_id,
    p_product_id,
    v_business_unit_id,
    p_quantity
  );

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
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
    ),
    v_business_unit_id
  );

  IF is_credit_payment_method(p_payment_method) THEN
    v_invoice_no := 'PPU-' || LEFT(v_purchase_id::TEXT, 8);

    INSERT INTO accounts_payable (
      vendor_name, invoice_number, expense_category, sub_category, description,
      invoice_date, due_date, amount, amount_paid, balance_due, status, notes,
      business_unit_id
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
      'Linked to product_purchases ' || v_purchase_id::TEXT,
      v_business_unit_id
    )
    RETURNING id INTO v_payable_id;

    UPDATE product_purchases
    SET accounts_payable_id = v_payable_id
    WHERE id = v_purchase_id;
  END IF;

  RETURN v_purchase_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_product_purchase(
  date, uuid, numeric, numeric, uuid, text, text, text,
  uuid, uuid, date, date, uuid
) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
