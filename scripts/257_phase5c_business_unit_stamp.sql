-- 257_phase5c_business_unit_stamp.sql
-- Stamp/inherit business_unit_id on Phase 5c create RPCs + triggers.
-- Columns already exist on staging; this only replaces function bodies.
-- DROP old overloads first (same pattern as 255/256).

BEGIN;

-- ---------------------------------------------------------------------------
-- create_purchase_order(+ p_business_unit_id)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_purchase_order(uuid, date, date, text, jsonb);
DROP FUNCTION IF EXISTS public.create_purchase_order(uuid, date, date, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_supplier_id uuid,
  p_order_date date,
  p_expected_date date,
  p_notes text,
  p_items jsonb,
  p_business_unit_id uuid DEFAULT NULL
)
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

GRANT EXECUTE ON FUNCTION public.create_purchase_order(uuid, date, date, text, jsonb, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_production_batch(+ p_business_unit_id)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_production_batch(text, date, uuid, numeric, text, jsonb, date, date);
DROP FUNCTION IF EXISTS public.create_production_batch(text, date, uuid, numeric, text, jsonb, date, date, uuid);

CREATE OR REPLACE FUNCTION public.create_production_batch(
  p_batch_number text,
  p_production_date date,
  p_finished_product_id uuid,
  p_quantity_produced numeric,
  p_notes text,
  p_materials jsonb,
  p_manufacturing_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL,
  p_business_unit_id uuid DEFAULT NULL
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

    SELECT average_cost_per_unit
    INTO v_cost_at_time
    FROM raw_materials
    WHERE id = v_material_id;

    INSERT INTO production_batch_materials (
      batch_id, material_id, quantity_used, cost_at_time
    )
    VALUES (v_batch_id, v_material_id, v_quantity_used, v_cost_at_time);

    UPDATE raw_materials
    SET current_stock = current_stock - v_quantity_used, updated_at = now()
    WHERE id = v_material_id;
  END LOOP;

  UPDATE finished_products
  SET current_stock = current_stock + p_quantity_produced, updated_at = now()
  WHERE id = p_finished_product_id;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_id, movement_date, notes
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
$function$;

GRANT EXECUTE ON FUNCTION public.create_production_batch(
  text, date, uuid, numeric, text, jsonb, date, date, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_product_purchase(+ p_business_unit_id); AP inherits purchase BU
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_product_purchase(
  date, uuid, numeric, numeric, uuid, text, text, uuid, uuid, date, date
);
DROP FUNCTION IF EXISTS public.create_product_purchase(
  date, uuid, numeric, numeric, uuid, text, text, uuid, uuid, date, date, uuid
);

CREATE OR REPLACE FUNCTION public.create_product_purchase(
  p_purchase_date date,
  p_product_id uuid,
  p_quantity numeric,
  p_cost_per_unit numeric,
  p_supplier_id uuid,
  p_payment_method text,
  p_notes text,
  p_po_id uuid DEFAULT NULL,
  p_po_item_id uuid DEFAULT NULL,
  p_manufacturing_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL,
  p_business_unit_id uuid DEFAULT NULL
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
  v_business_unit_id UUID := p_business_unit_id;
BEGIN
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
  date, uuid, numeric, numeric, uuid, text, text, uuid, uuid, date, date, uuid
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RM purchase finance trigger: AP inherits NEW.business_unit_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_raw_material_purchase_finance()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_go_live DATE;
  v_material_name TEXT;
  v_payable_id UUID;
  v_invoice_no TEXT;
BEGIN
  SELECT go_live_date INTO v_go_live
  FROM inventory_balance_config
  WHERE tenant_id = NEW.tenant_id;

  IF v_go_live IS NULL OR NEW.purchase_date < v_go_live THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS NULL OR TRIM(NEW.payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for raw material purchases';
  END IF;

  SELECT material_name INTO v_material_name
  FROM raw_materials
  WHERE id = NEW.material_id;

  IF is_credit_payment_method(NEW.payment_method) THEN
    v_invoice_no := 'RMP-' || LEFT(NEW.id::TEXT, 8);

    INSERT INTO accounts_payable (
      vendor_name, invoice_number, expense_category, sub_category, description,
      invoice_date, due_date, amount, amount_paid, balance_due, status, notes,
      business_unit_id
    )
    VALUES (
      COALESCE(NULLIF(TRIM(NEW.supplier), ''), 'Raw Material Supplier'),
      v_invoice_no, 'Direct Operational', 'Raw Materials',
      'Raw material purchase posted to inventory',
      NEW.purchase_date, NEW.purchase_date + INTERVAL '30 days',
      NEW.total_cost, 0, NEW.total_cost, 'Outstanding',
      'Linked to raw_material_purchases ' || NEW.id::TEXT,
      NEW.business_unit_id
    )
    RETURNING id INTO v_payable_id;

    UPDATE raw_material_purchases
    SET accounts_payable_id = v_payable_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- create_raw_material_purchase_payable: inherit from purchase row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_raw_material_purchase_payable(
  p_purchase_id uuid,
  p_material_id uuid,
  p_purchase_date date,
  p_supplier text,
  p_total_cost numeric
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_business_unit_id UUID;
BEGIN
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

-- ---------------------------------------------------------------------------
-- create_product_purchase_payable: inherit from purchase row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_product_purchase_payable(
  p_purchase_id uuid,
  p_product_id uuid,
  p_purchase_date date,
  p_supplier_name text,
  p_total_cost numeric
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_payable_id UUID;
  v_invoice_no TEXT;
  v_product_name TEXT;
  v_business_unit_id UUID;
BEGIN
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

-- ---------------------------------------------------------------------------
-- create_fixed_asset_payable: inherit from fixed_assets
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_fixed_asset_payable(
  p_tenant_id uuid,
  p_asset_id text,
  p_vendor_name text,
  p_purchase_date date,
  p_total_cost numeric,
  p_description text DEFAULT NULL
)
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

-- ---------------------------------------------------------------------------
-- Income tax ledger replace: inherit BU from income_register
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_income_register_tax_ledger_entries(
  p_source_id text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_system_adjustment boolean;
  v_business_unit_id uuid;
BEGIN
  IF p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'p_source_id is required';
  END IF;

  SELECT i.is_system_adjustment, i.business_unit_id
  INTO v_is_system_adjustment, v_business_unit_id
  FROM public.income_register i
  WHERE i.id::text = p_source_id;

  IF FOUND AND v_is_system_adjustment IS TRUE THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = p_source_id;
    RETURN;
  END IF;

  DELETE FROM public.tax_ledger_entries
  WHERE source_type = 'income_register'
    AND source_id = p_source_id;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.tax_ledger_entries (
    tenant_id,
    entry_date,
    period_month,
    direction,
    tax_component,
    rate_pct,
    taxable_base,
    tax_amount,
    status,
    source_type,
    source_id,
    counterparty_name,
    notes,
    business_unit_id
  )
  SELECT
    COALESCE(
      NULLIF(r->>'tenant_id', '')::uuid,
      public.current_user_tenant_id()
    ),
    (r->>'entry_date')::date,
    (r->>'period_month')::date,
    r->>'direction',
    r->>'tax_component',
    NULLIF(r->>'rate_pct', '')::numeric,
    COALESCE((r->>'taxable_base')::numeric, 0),
    COALESCE((r->>'tax_amount')::numeric, 0),
    COALESCE(NULLIF(r->>'status', ''), 'open'),
    'income_register',
    p_source_id,
    NULLIF(r->>'counterparty_name', ''),
    NULLIF(r->>'notes', ''),
    v_business_unit_id
  FROM jsonb_array_elements(p_rows) AS t(r);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb)
  TO authenticated, service_role;

COMMIT;
