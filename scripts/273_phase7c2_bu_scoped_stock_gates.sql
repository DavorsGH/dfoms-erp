-- Phase 7c.2 — BU-scoped stock availability gates
--   1. create_product_sale: gate on finished_product_balances
--   2. create_production_batch: gate + cost_at_time from raw_material_balances
--   3. apply_internal_consumption: add BU balance stock gate (previously none)
--
-- Dual-write / master updates unchanged. Apply staging then production.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. create_product_sale
-- ---------------------------------------------------------------------------
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

GRANT EXECUTE ON FUNCTION public.create_product_sale(
  date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. create_production_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_production_batch(
  p_batch_number text,
  p_production_date date,
  p_finished_product_id uuid,
  p_quantity_produced numeric,
  p_notes text,
  p_materials jsonb,
  p_manufacturing_date date DEFAULT NULL::date,
  p_expiration_date date DEFAULT NULL::date,
  p_business_unit_id uuid DEFAULT NULL::uuid
)
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

GRANT EXECUTE ON FUNCTION public.create_production_batch(
  text, date, uuid, numeric, text, jsonb, date, date, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. apply_internal_consumption
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_internal_consumption()
RETURNS TRIGGER
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

COMMIT;

NOTIFY pgrst, 'reload schema';
