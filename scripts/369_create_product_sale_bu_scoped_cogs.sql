BEGIN;

CREATE OR REPLACE FUNCTION public.finished_product_has_positive_cost_history(
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.production_batches pb
    WHERE pb.finished_product_id = p_product_id
      AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      AND coalesce(pb.total_batch_cost, 0) > 0
  )
  OR EXISTS (
    SELECT 1
    FROM public.product_purchases pp
    WHERE pp.product_id = p_product_id
      AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      AND coalesce(pp.total_cost, 0) > 0
  )
  OR EXISTS (
    SELECT 1
    FROM public.finished_product_stock_adjustments fsa
    WHERE fsa.product_id = p_product_id
      AND fsa.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      AND coalesce(fsa.quantity_delta, 0) <> 0
      AND coalesce(fsa.cost_per_unit, 0) > 0
  )
  OR EXISTS (
    SELECT 1
    FROM public.production_batches pb
    WHERE pb.finished_product_id = p_product_id
      AND coalesce(pb.total_batch_cost, 0) > 0
  )
  OR EXISTS (
    SELECT 1
    FROM public.product_purchases pp
    WHERE pp.product_id = p_product_id
      AND coalesce(pp.total_cost, 0) > 0
  );
$function$;

REVOKE ALL ON FUNCTION public.finished_product_has_positive_cost_history(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finished_product_has_positive_cost_history(uuid, uuid) TO authenticated, service_role;

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
  p_invoice_entity_type text DEFAULT 'PSI'::text,
  p_sales_rep_id text DEFAULT NULL::text,
  p_business_unit_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_income_id UUID;
  v_expense_id UUID;
  v_bu_stock NUMERIC(18, 4);
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
  v_sales_rep_id text := NULLIF(btrim(coalesce(p_sales_rep_id, '')), '');
  v_income_notes text;
BEGIN
  PERFORM public.assert_not_view_all_business_units();

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater';
  END IF;

  SELECT product_name, unit_of_measure, tenant_id
  INTO v_product_name, v_unit_of_measure, v_product_tenant_id
  FROM finished_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  PERFORM public.ensure_finished_product_balance(
    v_product_tenant_id,
    p_product_id,
    p_business_unit_id
  );

  SELECT current_stock
  INTO v_bu_stock
  FROM finished_product_balances
  WHERE product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  FOR UPDATE;

  IF v_bu_stock < p_quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot sell %',
      v_bu_stock,
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

  v_cogs_unit_cost := public.finished_product_inventory_outflow_unit_cost(
    p_product_id,
    p_business_unit_id
  );
  v_cogs_amount := ROUND(v_cogs_unit_cost * p_quantity, 4);
  v_cogs_receipt_no := 'COGS-' || TRIM(v_invoice_no);

  v_income_notes := NULLIF(TRIM(COALESCE(p_notes, '')), '');
  IF v_cogs_amount <= 0
     AND public.finished_product_has_positive_cost_history(p_product_id, p_business_unit_id) THEN
    v_income_notes := trim(
      coalesce(v_income_notes, '')
      || CASE WHEN v_income_notes IS NULL OR v_income_notes = '' THEN '' ELSE ' ' END
      || '[COGS_WARNING:zero unit cost at sale]'
    );
  END IF;

  INSERT INTO income_register (
    tenant_id,
    date, invoice_no, client_id, customer_name, entry_type, service_category,
    description, amount, amount_received, outstanding_balance, payment_status,
    due_date, notes, product_id, sale_quantity, unit_price, business_unit_id,
    sales_rep_id
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
    p_due_date, v_income_notes, p_product_id, p_quantity, p_unit_price, p_business_unit_id,
    v_sales_rep_id
  )
  RETURNING id INTO v_income_id;

  UPDATE finished_products
  SET current_stock = current_stock - p_quantity, updated_at = now()
  WHERE id = p_product_id;

  PERFORM public.adjust_finished_product_balance_qty(
    v_product_tenant_id,
    p_product_id,
    p_business_unit_id,
    -p_quantity
  );

  INSERT INTO stock_movements (
    tenant_id,
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
  )
  VALUES (
    v_product_tenant_id,
    p_product_id, 'sale_out', p_quantity, v_income_id, p_date,
    COALESCE(NULLIF(TRIM(p_notes), ''), 'Product sale invoice ' || v_invoice_no),
    p_business_unit_id
  );

  INSERT INTO expense_register (
    tenant_id,
    date, expense_category, sub_category, description, vendor, price,
    quantity, amount, payment_method, approved_by, receipt_no, payment_status, notes,
    business_unit_id
  )
  VALUES (
    v_product_tenant_id,
    p_date, 'Cost of Goods Sold', 'Product Sales',
    'Auto-posted COGS for product sale ' || v_invoice_no || ' (' || v_product_name || ')',
    'Internal', v_cogs_unit_cost, p_quantity, v_cogs_amount, 'Internal', 'System',
    v_cogs_receipt_no, 'Non-Cash', 'Linked to income_register ' || v_income_id::TEXT,
    p_business_unit_id
  )
  RETURNING id INTO v_expense_id;

  UPDATE income_register SET cogs_expense_id = v_expense_id WHERE id = v_income_id;

  RETURN v_income_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_product_sale(date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_product_sale(date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_product_sale(date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text, uuid) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
