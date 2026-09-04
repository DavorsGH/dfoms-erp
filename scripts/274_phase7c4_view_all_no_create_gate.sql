-- 274_phase7c4_view_all_no_create_gate.sql
-- Phase 7c.4: server-side refuse creates while user_accounts.view_all_business_units
-- is true (All Businesses switcher). Client stamp checks remain; this is the backup.
--
-- Tier A: inventory/POS create RPCs + stock triggers
-- Tier B: other create RPCs that stamp/inherit business_unit_id
--
-- REVIEW ONLY until explicitly applied (staging then production).
-- Bodies taken from staging pg_get_functiondef at draft time; only change is
-- PERFORM public.assert_not_view_all_business_units() as first statement after BEGIN.

BEGIN;

-- =============================================================================
-- Helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.current_user_view_all_business_units()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ua.view_all_business_units
      FROM public.user_accounts ua
      WHERE ua.auth_uid = auth.uid()
        AND ua.is_active IS NOT FALSE
    ),
    false
  );
$$;

COMMENT ON FUNCTION public.current_user_view_all_business_units() IS
  'True when the calling staff account has All Businesses selected (user_accounts.view_all_business_units).';

CREATE OR REPLACE FUNCTION public.assert_not_view_all_business_units()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- System / service_role / no JWT: do not block
  -- (same idea as resolveCreateBusinessUnitId({ useActiveContext: false }))
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF public.current_user_view_all_business_units() THEN
    RAISE EXCEPTION
      'Cannot create records while "All Businesses" is selected — switch to a specific business or workspace default first (dfoms-bu-view-all-no-stamp)';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_not_view_all_business_units() IS
  'RAISE when the calling user is on All Businesses; no-op otherwise (and when auth.uid() is null).';

GRANT EXECUTE ON FUNCTION public.current_user_view_all_business_units()
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_not_view_all_business_units()
  TO authenticated, service_role;


-- =============================================================================
-- Tier A
-- =============================================================================

-- create_product_sale
-- identity args (staging): p_date date, p_invoice_no text, p_client_id text, p_customer_name text, p_product_id uuid, p_quantity numeric, p_unit_price numeric, p_amount_received numeric, p_payment_status text, p_due_date date, p_description text, p_notes text, p_invoice_entity_type text, p_sales_rep_id text, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.create_product_sale(p_date date, p_invoice_no text, p_client_id text, p_customer_name text, p_product_id uuid, p_quantity numeric, p_unit_price numeric, p_amount_received numeric, p_payment_status text, p_due_date date, p_description text, p_notes text, p_invoice_entity_type text DEFAULT 'PSI'::text, p_sales_rep_id text DEFAULT NULL::text, p_business_unit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
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
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  -- dfoms-inv-7a-dual-write
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

  v_cogs_unit_cost := public.finished_product_weighted_avg_cost(p_product_id);
  v_cogs_amount := ROUND(v_cogs_unit_cost * p_quantity, 4);
  v_cogs_receipt_no := 'COGS-' || TRIM(v_invoice_no);

  INSERT INTO income_register (
    tenant_id,
    date, invoice_no, client_id, customer_name, entry_type, service_category,
    description, amount, amount_received, outstanding_balance, payment_status,
    due_date, notes, product_id, sale_quantity, unit_price, business_unit_id
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
    p_due_date, p_notes, p_product_id, p_quantity, p_unit_price, p_business_unit_id
  )
  RETURNING id INTO v_income_id;

  UPDATE finished_products
  SET current_stock = current_stock - p_quantity, updated_at = now()
  WHERE id = p_product_id;

  -- dual-write finished_product_balances
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
GRANT EXECUTE ON FUNCTION public.create_product_sale(p_date date, p_invoice_no text, p_client_id text, p_customer_name text, p_product_id uuid, p_quantity numeric, p_unit_price numeric, p_amount_received numeric, p_payment_status text, p_due_date date, p_description text, p_notes text, p_invoice_entity_type text, p_sales_rep_id text, p_business_unit_id uuid) TO authenticated, service_role;

-- create_production_batch
-- identity args (staging): p_batch_number text, p_production_date date, p_finished_product_id uuid, p_quantity_produced numeric, p_notes text, p_materials jsonb, p_manufacturing_date date, p_expiration_date date, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.create_production_batch(p_batch_number text, p_production_date date, p_finished_product_id uuid, p_quantity_produced numeric, p_notes text, p_materials jsonb, p_manufacturing_date date DEFAULT NULL::date, p_expiration_date date DEFAULT NULL::date, p_business_unit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_batch_id UUID;
  v_material JSONB;
  v_material_id UUID;
  v_quantity_used NUMERIC(18, 4);
  v_cost_at_time NUMERIC(18, 4);
  v_bu_material_stock NUMERIC(18, 4);
  v_total_batch_cost NUMERIC(18, 4) := 0;
  v_cost_per_unit NUMERIC(18, 4);
  v_material_tenant_id UUID;
  v_product_tenant_id UUID;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  -- dfoms-inv-7a-dual-write
  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_produced must be greater than zero';
  END IF;

  IF p_materials IS NULL OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required for a production batch';
  END IF;

  SELECT tenant_id INTO v_product_tenant_id
  FROM finished_products
  WHERE id = p_finished_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    IF v_material_id IS NULL OR v_quantity_used IS NULL OR v_quantity_used <= 0 THEN
      RAISE EXCEPTION 'Each material line requires material_id and quantity_used > 0';
    END IF;

    SELECT tenant_id
    INTO v_material_tenant_id
    FROM raw_materials
    WHERE id = v_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Raw material % not found', v_material_id;
    END IF;

    PERFORM public.ensure_raw_material_balance(
      v_material_tenant_id,
      v_material_id,
      p_business_unit_id
    );

    SELECT current_stock, average_cost_per_unit
    INTO v_bu_material_stock, v_cost_at_time
    FROM raw_material_balances
    WHERE material_id = v_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    FOR UPDATE;

    IF v_bu_material_stock < v_quantity_used THEN
      RAISE EXCEPTION 'Insufficient stock for material %. Available: %, required: %',
        v_material_id, v_bu_material_stock, v_quantity_used;
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
    expiration_date,
    business_unit_id
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
    p_expiration_date,
    p_business_unit_id
  )
  RETURNING id INTO v_batch_id;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::UUID;
    v_quantity_used := (v_material ->> 'quantity_used')::NUMERIC(18, 4);

    SELECT tenant_id
    INTO v_material_tenant_id
    FROM raw_materials
    WHERE id = v_material_id;

    SELECT average_cost_per_unit
    INTO v_cost_at_time
    FROM raw_material_balances
    WHERE material_id = v_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

    INSERT INTO production_batch_materials (
      batch_id, material_id, quantity_used, cost_at_time
    )
    VALUES (v_batch_id, v_material_id, v_quantity_used, v_cost_at_time);

    UPDATE raw_materials
    SET current_stock = current_stock - v_quantity_used, updated_at = now()
    WHERE id = v_material_id;

    -- dual-write raw_material_balances
    PERFORM public.adjust_raw_material_balance_qty(
      v_material_tenant_id,
      v_material_id,
      p_business_unit_id,
      -v_quantity_used
    );
  END LOOP;

  UPDATE finished_products
  SET current_stock = current_stock + p_quantity_produced, updated_at = now()
  WHERE id = p_finished_product_id;

  -- dual-write finished_product_balances
  PERFORM public.adjust_finished_product_balance_qty(
    v_product_tenant_id,
    p_finished_product_id,
    p_business_unit_id,
    p_quantity_produced
  );

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
  )
  VALUES (
    p_finished_product_id,
    'production_in',
    p_quantity_produced,
    v_batch_id,
    p_production_date,
    COALESCE(p_notes, 'Production batch ' || p_batch_number),
    p_business_unit_id
  );

  RETURN v_batch_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_production_batch(p_batch_number text, p_production_date date, p_finished_product_id uuid, p_quantity_produced numeric, p_notes text, p_materials jsonb, p_manufacturing_date date, p_expiration_date date, p_business_unit_id uuid) TO authenticated, service_role;

-- create_product_purchase
-- identity args (staging): p_purchase_date date, p_product_id uuid, p_quantity numeric, p_cost_per_unit numeric, p_supplier_id uuid, p_payment_method text, p_notes text, p_po_id uuid, p_po_item_id uuid, p_manufacturing_date date, p_expiration_date date, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.create_product_purchase(p_purchase_date date, p_product_id uuid, p_quantity numeric, p_cost_per_unit numeric, p_supplier_id uuid, p_payment_method text, p_notes text, p_po_id uuid DEFAULT NULL::uuid, p_po_item_id uuid DEFAULT NULL::uuid, p_manufacturing_date date DEFAULT NULL::date, p_expiration_date date DEFAULT NULL::date, p_business_unit_id uuid DEFAULT NULL::uuid)
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
  -- dfoms-inv-7a-dual-write
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  -- Receive-against-PO safety: inherit PO BU when caller omitted stamp.
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
    manufacturing_date, expiration_date, business_unit_id
  )
  VALUES (
    p_product_id, p_purchase_date, p_quantity, p_cost_per_unit, v_total_cost,
    p_supplier_id, p_payment_method, p_notes, p_po_id, p_po_item_id,
    p_manufacturing_date, p_expiration_date, v_business_unit_id
  )
  RETURNING id INTO v_purchase_id;

  UPDATE finished_products
  SET current_stock = current_stock + p_quantity, updated_at = now()
  WHERE id = p_product_id;

  -- dual-write finished_product_balances
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
GRANT EXECUTE ON FUNCTION public.create_product_purchase(p_purchase_date date, p_product_id uuid, p_quantity numeric, p_cost_per_unit numeric, p_supplier_id uuid, p_payment_method text, p_notes text, p_po_id uuid, p_po_item_id uuid, p_manufacturing_date date, p_expiration_date date, p_business_unit_id uuid) TO authenticated, service_role;

-- apply_internal_consumption
-- identity args (staging): (none)
CREATE OR REPLACE FUNCTION public.apply_internal_consumption()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_go_live DATE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_unit_cost NUMERIC(18, 4);
  v_expense_amount NUMERIC(18, 4);
  v_expense_id UUID;
  v_bu_stock NUMERIC(18, 4);
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE tenant_id = NEW.tenant_id;

  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = NEW.product_id;

  IF v_go_live IS NOT NULL AND NEW.consumption_date >= v_go_live THEN
    v_unit_cost := finished_product_weighted_avg_cost_scoped(
      NEW.product_id,
      NEW.business_unit_id
    );
    v_expense_amount := ROUND(NEW.quantity * v_unit_cost, 4);
  END IF;

  PERFORM public.ensure_finished_product_balance(
    NEW.tenant_id,
    NEW.product_id,
    NEW.business_unit_id
  );

  SELECT current_stock
  INTO v_bu_stock
  FROM finished_product_balances
  WHERE product_id = NEW.product_id
    AND business_unit_id IS NOT DISTINCT FROM NEW.business_unit_id
  FOR UPDATE;

  IF v_bu_stock < NEW.quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot consume %',
      v_bu_stock,
      v_unit_of_measure,
      v_product_name,
      NEW.quantity;
  END IF;

  UPDATE finished_products
  SET
    current_stock = current_stock - NEW.quantity,
    updated_at = now()
  WHERE id = NEW.product_id;

  PERFORM public.adjust_finished_product_balance_qty(
    NEW.tenant_id,
    NEW.product_id,
    NEW.business_unit_id,
    -NEW.quantity
  );

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes,
    business_unit_id
  )
  VALUES (
    NEW.product_id,
    'internal_consumption_out',
    NEW.quantity,
    NEW.id,
    NEW.consumption_date,
    COALESCE(
      NULLIF(TRIM(NEW.notes), ''),
      NULLIF(TRIM(NEW.reason), ''),
      'Internal consumption'
    ),
    NEW.business_unit_id
  );

  IF v_go_live IS NULL OR NEW.consumption_date < v_go_live THEN
    RETURN NEW;
  END IF;

  INSERT INTO expense_register (
    tenant_id,
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
    notes,
    business_unit_id
  )
  VALUES (
    NEW.tenant_id,
    NEW.consumption_date,
    'Direct Operational',
    'Finished Goods - Internal Use',
    'Auto-posted internal consumption of ' || v_product_name,
    'Internal',
    v_unit_cost,
    NEW.quantity,
    v_expense_amount,
    'Internal',
    'System',
    'IC-' || LEFT(NEW.id::TEXT, 8),
    'Non-Cash',
    'Linked to internal_consumption ' || NEW.id::TEXT,
    NEW.business_unit_id
  )
  RETURNING id INTO v_expense_id;

  UPDATE internal_consumption
  SET expense_register_id = v_expense_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.apply_internal_consumption() TO authenticated, service_role;

-- sync_offline_pos_cash_sale
-- identity args (staging): p_client_op_id uuid, p_payload jsonb, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.sync_offline_pos_cash_sale(p_client_op_id uuid, p_payload jsonb, p_business_unit_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_auth_tenant uuid;
  v_claim jsonb;
  v_existing jsonb;
  v_outcome text;
  v_sale_date date;
  v_client_id text;
  v_customer_name text;
  v_payment_method text;
  v_amount_received numeric(18, 4);
  v_notes text;
  v_provisional_token text;
  v_sales_rep_id text;
  v_lines jsonb;
  v_line jsonb;
  v_product_ids uuid[];
  v_pid uuid;
  v_stock numeric(18, 4);
  v_claimed numeric(18, 4);
  v_shortfall numeric(18, 4);
  v_stock_at_conflict jsonb := '[]'::jsonb;
  v_has_shortfall boolean := false;
  v_invoice_no text;
  v_income_ids uuid[] := ARRAY[]::uuid[];
  v_income_id uuid;
  v_line_total numeric(18, 4);
  v_line_recv numeric(18, 4);
  v_remaining numeric(18, 4);
  v_pos_notes text;
  v_suspense_invoice text;
  v_suspense_id uuid;
  v_conflict_id uuid;
  v_result jsonb;
  v_qty numeric(18, 4);
  v_unit_price numeric(18, 4);
  i int;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  IF p_client_op_id IS NULL THEN
    RAISE EXCEPTION 'p_client_op_id is required';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload must be a JSON object';
  END IF;

  v_lines := p_payload->'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines must be a non-empty array';
  END IF;

  v_auth_tenant := current_user_tenant_id();
  v_tenant_id := v_auth_tenant;
  IF v_tenant_id IS NULL THEN
    SELECT fp.tenant_id
    INTO v_tenant_id
    FROM public.finished_products fp
    WHERE fp.id = ((v_lines->0->>'product_id')::uuid);
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  -- Idempotent replay (match by client_op_id; tenant must agree)
  SELECT outcome, result
  INTO v_outcome, v_existing
  FROM public.offline_pos_ops
  WHERE client_op_id = p_client_op_id;

  IF FOUND THEN
    IF (SELECT tenant_id FROM public.offline_pos_ops WHERE client_op_id = p_client_op_id) <> v_tenant_id THEN
      RAISE EXCEPTION 'client_op_id belongs to another tenant';
    END IF;
    RETURN v_existing || jsonb_build_object('status', v_outcome, 'idempotent', true);
  END IF;

  BEGIN
    v_sale_date := (p_payload->>'sale_date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid sale_date';
  END;

  IF v_sale_date IS NULL THEN
    RAISE EXCEPTION 'sale_date is required';
  END IF;

  v_client_id := NULLIF(btrim(coalesce(p_payload->>'client_id', '')), '');
  v_customer_name := NULLIF(btrim(coalesce(p_payload->>'customer_name', '')), '');
  v_payment_method := btrim(coalesce(p_payload->>'payment_method', ''));
  v_amount_received := ROUND(COALESCE((p_payload->>'amount_received')::numeric, 0), 4);
  v_notes := NULLIF(btrim(coalesce(p_payload->>'notes', '')), '');
  v_provisional_token := NULLIF(btrim(coalesce(p_payload->>'provisional_token', '')), '');
  v_sales_rep_id := NULLIF(btrim(coalesce(p_payload->>'sales_rep_id', '')), '');

  IF lower(v_payment_method) <> 'cash' THEN
    RAISE EXCEPTION 'Only Cash payments can sync offline (got %)', v_payment_method;
  END IF;

  IF v_provisional_token IS NULL THEN
    RAISE EXCEPTION 'provisional_token is required';
  END IF;

  IF v_amount_received < 0 THEN
    RAISE EXCEPTION 'amount_received must be >= 0';
  END IF;

  -- Persist queue-time BU on claim so conflict resolve can stamp create_product_sale.
  v_claim := COALESCE(p_payload, '{}'::jsonb)
    || jsonb_build_object('business_unit_id', p_business_unit_id);

  -- Collect + sort product ids for lock order
  SELECT array_agg(DISTINCT (elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(v_lines) AS elem;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No valid product_id values in lines';
  END IF;

  -- Lock products; verify tenant + stock
  FOREACH v_pid IN ARRAY v_product_ids LOOP
    SELECT fp.current_stock
    INTO v_stock
    FROM public.finished_products fp
    WHERE fp.id = v_pid
      AND fp.tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found for tenant', v_pid;
    END IF;

    SELECT COALESCE(SUM((elem->>'quantity')::numeric), 0)
    INTO v_claimed
    FROM jsonb_array_elements(v_lines) AS elem
    WHERE (elem->>'product_id')::uuid = v_pid;

    v_shortfall := GREATEST(v_claimed - COALESCE(v_stock, 0), 0);
    IF v_shortfall > 0 THEN
      v_has_shortfall := true;
    END IF;

    v_stock_at_conflict := v_stock_at_conflict || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_pid,
        'claimed_qty', v_claimed,
        'stock_qty', COALESCE(v_stock, 0),
        'shortfall', v_shortfall
      )
    );
  END LOOP;

  IF v_has_shortfall THEN
    v_suspense_invoice := public.generate_next_code(v_tenant_id, 'OSC', 4);

    INSERT INTO public.income_register (
      tenant_id,
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
      client_op_id
    )
    VALUES (
      v_tenant_id,
      v_sale_date,
      v_suspense_invoice,
      v_client_id,
      CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
      'offline_cash_suspense'::public.income_entry_type,
      'Offline Cash Clearing',
      'Offline POS cash suspense for ' || v_provisional_token,
      v_amount_received,
      v_amount_received,
      0,
      'Paid',
      v_sale_date,
      coalesce(v_notes, '')
        || E'\nOffline provisional token: ' || v_provisional_token
        || E'\nclient_op_id=' || p_client_op_id::text,
      p_client_op_id
    )
    RETURNING id INTO v_suspense_id;

    INSERT INTO public.offline_sale_conflicts (
      tenant_id,
      client_op_id,
      status,
      claim,
      stock_at_conflict,
      suspense_income_id,
      suspense_invoice_no,
      created_by
    )
    VALUES (
      v_tenant_id,
      p_client_op_id,
      'open',
      v_claim,
      v_stock_at_conflict,
      v_suspense_id,
      v_suspense_invoice,
      auth.uid()
    )
    RETURNING id INTO v_conflict_id;

    v_result := jsonb_build_object(
      'status', 'conflict',
      'conflict_id', v_conflict_id,
      'suspense_invoice_no', v_suspense_invoice,
      'suspense_income_id', v_suspense_id,
      'stock_at_conflict', v_stock_at_conflict,
      'business_unit_id', p_business_unit_id
    );

    INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
    VALUES (p_client_op_id, v_tenant_id, 'conflict', v_result);

    RETURN v_result;
  END IF;

  -- Clean path
  v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
  v_pos_notes := 'Payment method: Cash'
    || CASE WHEN v_notes IS NOT NULL THEN E'\n' || v_notes ELSE '' END
    || E'\nOffline provisional token: ' || v_provisional_token
    || E'\nclient_op_id=' || p_client_op_id::text;

  v_remaining := v_amount_received;

  FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->i;
    v_qty := ROUND(COALESCE((v_line->>'quantity')::numeric, 0), 4);
    v_unit_price := ROUND(COALESCE((v_line->>'unit_price')::numeric, 0), 4);
    v_line_total := ROUND(v_qty * v_unit_price, 4);

    IF i = jsonb_array_length(v_lines) - 1 THEN
      v_line_recv := v_remaining;
    ELSE
      v_line_recv := ROUND(LEAST(v_line_total, GREATEST(v_remaining, 0)), 4);
      v_remaining := ROUND(v_remaining - v_line_recv, 4);
    END IF;

    v_income_id := public.create_product_sale(
      v_sale_date,
      v_invoice_no,
      v_client_id,
      CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
      (v_line->>'product_id')::uuid,
      v_qty,
      v_unit_price,
      v_line_recv,
      'Paid',
      v_sale_date,
      NULL,
      v_pos_notes,
      'POS',
      v_sales_rep_id,
      p_business_unit_id
    );

    UPDATE public.income_register
    SET client_op_id = p_client_op_id
    WHERE id = v_income_id
      AND tenant_id = v_tenant_id;

    v_income_ids := array_append(v_income_ids, v_income_id);
  END LOOP;

  v_result := jsonb_build_object(
    'status', 'synced',
    'invoice_no', v_invoice_no,
    'income_ids', to_jsonb(v_income_ids),
    'business_unit_id', p_business_unit_id
  );

  INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
  VALUES (p_client_op_id, v_tenant_id, 'synced', v_result);

  RETURN v_result;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.sync_offline_pos_cash_sale(p_client_op_id uuid, p_payload jsonb, p_business_unit_id uuid) TO authenticated, service_role;

-- create_purchase_order
-- identity args (staging): p_supplier_id uuid, p_order_date date, p_expected_date date, p_notes text, p_items jsonb, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.create_purchase_order(p_supplier_id uuid, p_order_date date, p_expected_date date, p_notes text, p_items jsonb, p_business_unit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_po_id UUID;
  v_po_number TEXT;
  v_year TEXT;
  v_seq INTEGER;
  v_item JSONB;
  v_item_type TEXT;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required for a purchase order';
  END IF;

  v_year := TO_CHAR(p_order_date, 'YYYY');

  SELECT COUNT(*) + 1 INTO v_seq
  FROM purchase_orders
  WHERE po_number LIKE 'PO-' || v_year || '-%'
    AND tenant_matches(tenant_id);

  v_po_number := 'PO-' || v_year || '-' || LPAD(v_seq::TEXT, 3, '0');

  INSERT INTO purchase_orders (
    po_number, supplier_id, order_date, expected_date, notes, business_unit_id
  )
  VALUES (
    v_po_number, p_supplier_id, p_order_date, p_expected_date, p_notes, p_business_unit_id
  )
  RETURNING id INTO v_po_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_item_type := v_item ->> 'item_type';

    IF v_item_type NOT IN ('raw_material', 'finished_product') THEN
      RAISE EXCEPTION 'item_type must be raw_material or finished_product';
    END IF;

    INSERT INTO purchase_order_items (
      po_id, item_type, raw_material_id, finished_product_id,
      quantity_ordered, unit_cost, business_unit_id
    )
    VALUES (
      v_po_id,
      v_item_type,
      CASE WHEN v_item_type = 'raw_material' THEN (v_item ->> 'raw_material_id')::UUID ELSE NULL END,
      CASE WHEN v_item_type = 'finished_product' THEN (v_item ->> 'finished_product_id')::UUID ELSE NULL END,
      (v_item ->> 'quantity_ordered')::NUMERIC,
      (v_item ->> 'unit_cost')::NUMERIC,
      p_business_unit_id
    );
  END LOOP;

  RETURN v_po_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_purchase_order(p_supplier_id uuid, p_order_date date, p_expected_date date, p_notes text, p_items jsonb, p_business_unit_id uuid) TO authenticated, service_role;

-- apply_raw_material_purchase
-- identity args (staging): (none)
CREATE OR REPLACE FUNCTION public.apply_raw_material_purchase()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_stock NUMERIC(18,4);
  v_old_avg NUMERIC(18,4);
  v_old_value NUMERIC(18,4);
  v_new_stock NUMERIC(18,4);
  v_new_value NUMERIC(18,4);
  v_new_avg NUMERIC(18,4);
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  -- dfoms-inv-7a-dual-write
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 4);
  SELECT current_stock, average_cost_per_unit
  INTO v_old_stock, v_old_avg
  FROM raw_materials
  WHERE id = NEW.material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found for purchase', NEW.material_id;
  END IF;
  v_old_value := ROUND(v_old_stock * v_old_avg, 4);
  v_new_stock := v_old_stock + NEW.quantity;
  v_new_value := v_old_value + NEW.total_cost;
  IF v_new_stock <= 0 THEN
    v_new_avg := 0;
  ELSE
    v_new_avg := ROUND(v_new_value / v_new_stock, 4);
  END IF;
  UPDATE raw_materials
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE id = NEW.material_id;

  -- dual-write raw_material_balances
  PERFORM public.apply_raw_material_balance_purchase(
    NEW.tenant_id,
    NEW.material_id,
    NEW.business_unit_id,
    NEW.quantity,
    NEW.total_cost
  );

  RETURN NEW;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.apply_raw_material_purchase() TO authenticated, service_role;

-- =============================================================================
-- Tier B
-- =============================================================================

-- create_sales_opportunity
-- identity args (staging): p_client_id text, p_opportunity_name text, p_estimated_value numeric, p_probability numeric, p_expected_close_date date, p_source text, p_assigned_to text, p_notes text, p_business_unit_id uuid
CREATE OR REPLACE FUNCTION public.create_sales_opportunity(p_client_id text, p_opportunity_name text, p_estimated_value numeric, p_probability numeric, p_expected_close_date date, p_source text, p_assigned_to text, p_notes text, p_business_unit_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tenant_id UUID;
  v_opportunity_id UUID;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot create opportunity without tenant context';
  END IF;

  IF p_opportunity_name IS NULL OR TRIM(p_opportunity_name) = '' THEN
    RAISE EXCEPTION 'Opportunity name is required';
  END IF;

  INSERT INTO sales_opportunities (
    tenant_id, client_id, opportunity_name, estimated_value, probability,
    expected_close_date, source, assigned_to, notes, business_unit_id
  )
  VALUES (
    v_tenant_id, p_client_id, p_opportunity_name, p_estimated_value, p_probability,
    p_expected_close_date, p_source, p_assigned_to, p_notes, p_business_unit_id
  )
  RETURNING id INTO v_opportunity_id;

  RETURN v_opportunity_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_sales_opportunity(p_client_id text, p_opportunity_name text, p_estimated_value numeric, p_probability numeric, p_expected_close_date date, p_source text, p_assigned_to text, p_notes text, p_business_unit_id uuid) TO authenticated, service_role;

-- create_product_purchase_payable
-- identity args (staging): p_purchase_id uuid, p_product_id uuid, p_purchase_date date, p_supplier_name text, p_total_cost numeric
CREATE OR REPLACE FUNCTION public.create_product_purchase_payable(p_purchase_id uuid, p_product_id uuid, p_purchase_date date, p_supplier_name text, p_total_cost numeric)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_product_name TEXT;
  v_business_unit_id UUID;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  SELECT product_name INTO v_product_name
  FROM finished_products
  WHERE id = p_product_id;

  SELECT business_unit_id INTO v_business_unit_id
  FROM product_purchases
  WHERE id = p_purchase_id;

  v_invoice_no := 'PPU-' || LEFT(p_purchase_id::TEXT, 8);

  INSERT INTO accounts_payable (
    vendor_name, invoice_number, expense_category, sub_category, description,
    invoice_date, due_date, amount, amount_paid, balance_due, status, notes,
    business_unit_id
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
    'Linked to product_purchases ' || p_purchase_id::TEXT,
    v_business_unit_id
  )
  RETURNING id INTO v_payable_id;

  UPDATE product_purchases
  SET accounts_payable_id = v_payable_id
  WHERE id = p_purchase_id;

  RETURN v_payable_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_product_purchase_payable(p_purchase_id uuid, p_product_id uuid, p_purchase_date date, p_supplier_name text, p_total_cost numeric) TO authenticated, service_role;

-- create_raw_material_purchase_payable
-- identity args (staging): p_purchase_id uuid, p_material_id uuid, p_purchase_date date, p_supplier text, p_total_cost numeric
CREATE OR REPLACE FUNCTION public.create_raw_material_purchase_payable(p_purchase_id uuid, p_material_id uuid, p_purchase_date date, p_supplier text, p_total_cost numeric)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_business_unit_id UUID;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  SELECT business_unit_id INTO v_business_unit_id
  FROM raw_material_purchases
  WHERE id = p_purchase_id;

  v_invoice_no := 'RMP-' || LEFT(p_purchase_id::TEXT, 8);

  INSERT INTO accounts_payable (
    vendor_name, invoice_number, expense_category, sub_category, description,
    invoice_date, due_date, amount, amount_paid, balance_due, status, notes,
    business_unit_id
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
    'Linked to raw_material_purchases ' || p_purchase_id::TEXT,
    v_business_unit_id
  )
  RETURNING id INTO v_payable_id;

  UPDATE raw_material_purchases
  SET accounts_payable_id = v_payable_id
  WHERE id = p_purchase_id;

  RETURN v_payable_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_raw_material_purchase_payable(p_purchase_id uuid, p_material_id uuid, p_purchase_date date, p_supplier text, p_total_cost numeric) TO authenticated, service_role;

-- create_fixed_asset_payable
-- identity args (staging): p_tenant_id uuid, p_asset_id text, p_vendor_name text, p_purchase_date date, p_total_cost numeric, p_description text
CREATE OR REPLACE FUNCTION public.create_fixed_asset_payable(p_tenant_id uuid, p_asset_id text, p_vendor_name text, p_purchase_date date, p_total_cost numeric, p_description text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payable_id uuid;
  v_invoice_no text;
  v_business_unit_id uuid;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  SELECT business_unit_id INTO v_business_unit_id
  FROM fixed_assets
  WHERE asset_id = p_asset_id
    AND tenant_id = p_tenant_id;

  v_invoice_no := 'FAP-' || LEFT(p_asset_id, 8);

  INSERT INTO accounts_payable (
    tenant_id,
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
    notes,
    source_type,
    source_id,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    COALESCE(NULLIF(TRIM(p_vendor_name), ''), 'Fixed Asset Supplier'),
    v_invoice_no,
    'Fixed Assets',
    'Fixed Asset Purchases',
    COALESCE(p_description, 'Fixed asset purchase on credit'),
    p_purchase_date,
    p_purchase_date + INTERVAL '30 days',
    p_total_cost,
    0,
    p_total_cost,
    'Outstanding',
    'Linked to fixed_assets ' || p_asset_id,
    'fixed_asset',
    p_asset_id,
    v_business_unit_id
  )
  RETURNING id INTO v_payable_id;

  RETURN v_payable_id;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.create_fixed_asset_payable(p_tenant_id uuid, p_asset_id text, p_vendor_name text, p_purchase_date date, p_total_cost numeric, p_description text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
