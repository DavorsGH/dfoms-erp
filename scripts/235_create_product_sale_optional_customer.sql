-- =============================================================================
-- 235_create_product_sale_optional_customer.sql
--
-- DO NOT apply to production without explicit approval.
-- Apply to staging first via scripts/apply-235-create-product-sale-optional-customer-staging.ts
--
-- Makes customer / walk-in payer optional on create_product_sale (POS + Product
-- Sales). Stock, income, and COGS behavior is unchanged.
--
-- Safe to re-run (idempotent CREATE OR REPLACE).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_product_sale(
  p_date date,
  p_invoice_no text,
  p_client_id text,
  p_customer_name text,
  p_product_id uuid,
  p_quantity numeric,
  p_unit_price numeric,
  p_amount_received numeric,
  p_payment_status text,
  p_due_date date,
  p_description text,
  p_notes text,
  p_invoice_entity_type text DEFAULT 'PSI',
  p_sales_rep_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_income_id UUID;
  v_expense_id UUID;
  v_current_stock NUMERIC(18, 4);
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_product_tenant_id UUID;
  v_amount NUMERIC(18, 4);
  v_outstanding NUMERIC(18, 4);
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_receipt_no TEXT;
  v_invoice_no TEXT;
  v_entity_type TEXT;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater';
  END IF;

  -- Customer / walk-in payer are optional (POS anonymous cash sales).

  SELECT current_stock, product_name, unit_of_measure, tenant_id
  INTO v_current_stock, v_product_name, v_unit_of_measure, v_product_tenant_id
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

  v_invoice_no := NULLIF(TRIM(COALESCE(p_invoice_no, '')), '');
  IF v_invoice_no IS NULL THEN
    IF v_product_tenant_id IS NULL THEN
      v_product_tenant_id := current_user_tenant_id();
    END IF;
    IF v_product_tenant_id IS NULL THEN
      RAISE EXCEPTION 'Cannot auto-generate invoice_no without tenant context';
    END IF;

    v_entity_type := upper(btrim(coalesce(p_invoice_entity_type, 'PSI')));
    IF v_entity_type !~ '^[A-Z0-9_-]{1,16}$' THEN
      RAISE EXCEPTION 'p_invoice_entity_type must be 1–16 chars of A-Z, 0-9, _ or - (got %)', p_invoice_entity_type;
    END IF;

    v_invoice_no := public.generate_next_code(v_product_tenant_id, v_entity_type, 4);
  END IF;

  v_amount := ROUND(p_quantity * p_unit_price, 4);
  v_outstanding := ROUND(v_amount - COALESCE(p_amount_received, 0), 4);

  v_cogs_unit_cost := public.finished_product_weighted_avg_cost(p_product_id);
  v_cogs_amount := ROUND(v_cogs_unit_cost * p_quantity, 4);
  v_cogs_receipt_no := 'COGS-' || TRIM(v_invoice_no);

  INSERT INTO income_register (
    tenant_id,
    date, invoice_no, client_id, customer_name, entry_type, service_category,
    description, amount, amount_received, outstanding_balance, payment_status,
    due_date, notes, product_id, sale_quantity, unit_price
  )
  VALUES (
    v_product_tenant_id,
    p_date, v_invoice_no, NULLIF(TRIM(p_client_id), ''),
    CASE
      WHEN NULLIF(TRIM(p_client_id), '') IS NULL
        THEN NULLIF(TRIM(p_customer_name), '')
      ELSE NULL
    END,
    'product_sale', NULL,
    COALESCE(
      NULLIF(TRIM(p_description), ''),
      'Product sale: ' || v_product_name || ' x ' || p_quantity || ' ' || v_unit_of_measure
    ),
    v_amount, COALESCE(p_amount_received, 0), v_outstanding, p_payment_status,
    p_due_date, p_notes, p_product_id, p_quantity, p_unit_price
  )
  RETURNING id INTO v_income_id;

  UPDATE finished_products
  SET current_stock = current_stock - p_quantity, updated_at = now()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (
    tenant_id,
    product_id, movement_type, quantity, reference_id, movement_date, notes
  )
  VALUES (
    v_product_tenant_id,
    p_product_id, 'sale_out', p_quantity, v_income_id, p_date,
    COALESCE(NULLIF(TRIM(p_notes), ''), 'Product sale invoice ' || v_invoice_no)
  );

  INSERT INTO expense_register (
    tenant_id,
    date, expense_category, sub_category, description, vendor, price,
    quantity, amount, payment_method, approved_by, receipt_no, payment_status, notes
  )
  VALUES (
    v_product_tenant_id,
    p_date, 'Cost of Goods Sold', 'Product Sales',
    'Auto-posted COGS for product sale ' || v_invoice_no || ' (' || v_product_name || ')',
    'Internal', v_cogs_unit_cost, p_quantity, v_cogs_amount, 'Internal', 'System',
    v_cogs_receipt_no, 'Non-Cash', 'Linked to income_register ' || v_income_id::TEXT
  )
  RETURNING id INTO v_expense_id;

  UPDATE income_register SET cogs_expense_id = v_expense_id WHERE id = v_income_id;

  RETURN v_income_id;
END;
$function$;

COMMENT ON FUNCTION public.create_product_sale(
  date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text
) IS
  'Creates a product sale income row + stock movement + COGS expense. Customer/client and walk-in payer name are optional.';

COMMIT;
