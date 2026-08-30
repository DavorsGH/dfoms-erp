-- Phase 7a: inventory balance tables + null-BU backfill + dual-write plumbing.
-- Marker: dfoms-inv-7a-dual-write (helpers + dual-write RPC/trigger bodies).
-- Apply via scripts/apply-264-phase7a-inventory-balances.ts only.

BEGIN;

-- =============================================================================
-- A. raw_material_balances
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.raw_material_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  business_unit_id uuid NULL REFERENCES public.business_units(id),
  current_stock numeric(18,4) NOT NULL DEFAULT 0,
  average_cost_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  reorder_level numeric(18,4) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'raw_material_balances_tenant_material_bu_unique'
  ) THEN
    ALTER TABLE public.raw_material_balances
      ADD CONSTRAINT raw_material_balances_tenant_material_bu_unique
      UNIQUE NULLS NOT DISTINCT (tenant_id, material_id, business_unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_raw_material_balances_tenant_bu
  ON public.raw_material_balances (tenant_id, business_unit_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_balances_material_id
  ON public.raw_material_balances (material_id);

ALTER TABLE public.raw_material_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS raw_material_balances_tenant_select ON public.raw_material_balances;
CREATE POLICY raw_material_balances_tenant_select
  ON public.raw_material_balances FOR SELECT TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_balances_tenant_insert ON public.raw_material_balances;
CREATE POLICY raw_material_balances_tenant_insert
  ON public.raw_material_balances FOR INSERT TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_balances_tenant_update ON public.raw_material_balances;
CREATE POLICY raw_material_balances_tenant_update
  ON public.raw_material_balances FOR UPDATE TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_balances_tenant_delete ON public.raw_material_balances;
CREATE POLICY raw_material_balances_tenant_delete
  ON public.raw_material_balances FOR DELETE TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_material_balances TO authenticated;
GRANT ALL ON public.raw_material_balances TO service_role;

-- =============================================================================
-- B. finished_product_balances
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.finished_product_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  product_id uuid NOT NULL REFERENCES public.finished_products(id) ON DELETE CASCADE,
  business_unit_id uuid NULL REFERENCES public.business_units(id),
  current_stock numeric(18,4) NOT NULL DEFAULT 0,
  average_cost_per_unit numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'finished_product_balances_tenant_product_bu_unique'
  ) THEN
    ALTER TABLE public.finished_product_balances
      ADD CONSTRAINT finished_product_balances_tenant_product_bu_unique
      UNIQUE NULLS NOT DISTINCT (tenant_id, product_id, business_unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_finished_product_balances_tenant_bu
  ON public.finished_product_balances (tenant_id, business_unit_id);
CREATE INDEX IF NOT EXISTS idx_finished_product_balances_product_id
  ON public.finished_product_balances (product_id);

ALTER TABLE public.finished_product_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finished_product_balances_tenant_select ON public.finished_product_balances;
CREATE POLICY finished_product_balances_tenant_select
  ON public.finished_product_balances FOR SELECT TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_balances_tenant_insert ON public.finished_product_balances;
CREATE POLICY finished_product_balances_tenant_insert
  ON public.finished_product_balances FOR INSERT TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_balances_tenant_update ON public.finished_product_balances;
CREATE POLICY finished_product_balances_tenant_update
  ON public.finished_product_balances FOR UPDATE TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_balances_tenant_delete ON public.finished_product_balances;
CREATE POLICY finished_product_balances_tenant_delete
  ON public.finished_product_balances FOR DELETE TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.finished_product_balances TO authenticated;
GRANT ALL ON public.finished_product_balances TO service_role;

-- =============================================================================
-- C. internal_consumption / stock_movements business_unit_id
-- =============================================================================
ALTER TABLE public.internal_consumption
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_units(id);

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_units(id);

CREATE INDEX IF NOT EXISTS idx_internal_consumption_tenant_bu
  ON public.internal_consumption (tenant_id, business_unit_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_bu
  ON public.stock_movements (tenant_id, business_unit_id);

-- =============================================================================
-- D. inventory_balance_config evolve
-- =============================================================================
ALTER TABLE public.inventory_balance_config
  ADD COLUMN IF NOT EXISTS business_unit_id uuid REFERENCES public.business_units(id);

UPDATE public.inventory_balance_config
SET business_unit_id = NULL
WHERE business_unit_id IS NULL;

DO $$
DECLARE
  v_pk_def text;
  v_max integer;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_pk_def
  FROM pg_constraint
  WHERE conrelid = 'public.inventory_balance_config'::regclass
    AND conname = 'inventory_balance_config_pkey';

  IF v_pk_def IS DISTINCT FROM 'PRIMARY KEY (id)' THEN
    IF v_pk_def IS NOT NULL THEN
      ALTER TABLE public.inventory_balance_config
        DROP CONSTRAINT inventory_balance_config_pkey;
    END IF;

    ALTER TABLE public.inventory_balance_config
      DROP CONSTRAINT IF EXISTS inventory_balance_config_id_check;

    WITH numbered AS (
      SELECT ctid,
             ROW_NUMBER() OVER (ORDER BY tenant_id, created_at) AS new_id
      FROM public.inventory_balance_config
    )
    UPDATE public.inventory_balance_config ibc
    SET id = numbered.new_id
    FROM numbered
    WHERE ibc.ctid = numbered.ctid;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'inventory_balance_config_id_seq'
        AND c.relkind = 'S'
    ) THEN
      CREATE SEQUENCE public.inventory_balance_config_id_seq;
    END IF;

    ALTER SEQUENCE public.inventory_balance_config_id_seq
      OWNED BY public.inventory_balance_config.id;

    ALTER TABLE public.inventory_balance_config
      ALTER COLUMN id SET DEFAULT nextval('public.inventory_balance_config_id_seq');

    SELECT COALESCE(MAX(id), 0) INTO v_max FROM public.inventory_balance_config;
    IF v_max < 1 THEN
      PERFORM setval('public.inventory_balance_config_id_seq', 1, false);
    ELSE
      PERFORM setval('public.inventory_balance_config_id_seq', v_max, true);
    END IF;

    ALTER TABLE public.inventory_balance_config
      ADD CONSTRAINT inventory_balance_config_pkey PRIMARY KEY (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_balance_config_tenant_bu_unique'
  ) THEN
    ALTER TABLE public.inventory_balance_config
      ADD CONSTRAINT inventory_balance_config_tenant_bu_unique
      UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_balance_config_tenant_bu
  ON public.inventory_balance_config (tenant_id, business_unit_id);

GRANT USAGE, SELECT ON SEQUENCE public.inventory_balance_config_id_seq
  TO authenticated, service_role;

-- =============================================================================
-- Backfill: one null-BU balance per master
-- =============================================================================
INSERT INTO public.raw_material_balances (
  tenant_id, material_id, business_unit_id,
  current_stock, average_cost_per_unit, reorder_level
)
SELECT
  rm.tenant_id, rm.id, NULL,
  COALESCE(rm.current_stock, 0),
  COALESCE(rm.average_cost_per_unit, 0),
  rm.reorder_level
FROM public.raw_materials rm
ON CONFLICT ON CONSTRAINT raw_material_balances_tenant_material_bu_unique DO NOTHING;

INSERT INTO public.finished_product_balances (
  tenant_id, product_id, business_unit_id,
  current_stock, average_cost_per_unit
)
SELECT
  fp.tenant_id, fp.id, NULL,
  COALESCE(fp.current_stock, 0),
  COALESCE(public.finished_product_weighted_avg_cost(fp.id), 0)
FROM public.finished_products fp
ON CONFLICT ON CONSTRAINT finished_product_balances_tenant_product_bu_unique DO NOTHING;

-- =============================================================================
-- Helpers (SECURITY INVOKER) — marker dfoms-inv-7a-dual-write
-- =============================================================================
CREATE OR REPLACE FUNCTION public.ensure_raw_material_balance(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  -- dfoms-inv-7a-dual-write
  INSERT INTO public.raw_material_balances (
    tenant_id, material_id, business_unit_id,
    current_stock, average_cost_per_unit, reorder_level
  )
  VALUES (p_tenant_id, p_material_id, p_business_unit_id, 0, 0, NULL)
  ON CONFLICT ON CONSTRAINT raw_material_balances_tenant_material_bu_unique
  DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_raw_material_balance_purchase(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid,
  p_qty numeric,
  p_total_cost numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_old_stock numeric(18,4);
  v_old_avg numeric(18,4);
  v_old_value numeric(18,4);
  v_new_stock numeric(18,4);
  v_new_value numeric(18,4);
  v_new_avg numeric(18,4);
BEGIN
  -- dfoms-inv-7a-dual-write
  PERFORM public.ensure_raw_material_balance(p_tenant_id, p_material_id, p_business_unit_id);

  SELECT current_stock, average_cost_per_unit
  INTO v_old_stock, v_old_avg
  FROM public.raw_material_balances
  WHERE tenant_id = p_tenant_id
    AND material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'raw_material_balances row missing for material % bu %',
      p_material_id, p_business_unit_id;
  END IF;

  v_old_value := ROUND(v_old_stock * v_old_avg, 4);
  v_new_stock := v_old_stock + p_qty;
  v_new_value := v_old_value + p_total_cost;
  IF v_new_stock <= 0 THEN
    v_new_avg := 0;
  ELSE
    v_new_avg := ROUND(v_new_value / v_new_stock, 4);
  END IF;

  UPDATE public.raw_material_balances
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_raw_material_balance_qty(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid,
  p_qty_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  -- dfoms-inv-7a-dual-write
  PERFORM public.ensure_raw_material_balance(p_tenant_id, p_material_id, p_business_unit_id);

  UPDATE public.raw_material_balances
  SET current_stock = current_stock + p_qty_delta,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_finished_product_balance(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  -- dfoms-inv-7a-dual-write
  INSERT INTO public.finished_product_balances (
    tenant_id, product_id, business_unit_id,
    current_stock, average_cost_per_unit
  )
  VALUES (p_tenant_id, p_product_id, p_business_unit_id, 0, 0)
  ON CONFLICT ON CONSTRAINT finished_product_balances_tenant_product_bu_unique
  DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_finished_product_balance_qty(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_qty_delta numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
BEGIN
  -- dfoms-inv-7a-dual-write
  PERFORM public.ensure_finished_product_balance(p_tenant_id, p_product_id, p_business_unit_id);

  UPDATE public.finished_product_balances
  SET current_stock = current_stock + p_qty_delta,
      average_cost_per_unit = COALESCE(
        public.finished_product_weighted_avg_cost(p_product_id),
        0
      ),
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.ensure_raw_material_balance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.apply_raw_material_balance_purchase(uuid, uuid, uuid, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_raw_material_balance_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_finished_product_balance(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_raw_material_balance(uuid, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_raw_material_balance_purchase(uuid, uuid, uuid, numeric, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_raw_material_balance_qty(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_finished_product_balance(uuid, uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;

-- =============================================================================
-- Dual-write: apply_raw_material_purchase (trigger) — same signature
-- =============================================================================
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

-- =============================================================================
-- Dual-write: create_product_sale — same signature
-- Drop legacy overloads (no BU arg) so only the dual-write body remains.
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_product_sale(
  date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text
);
DROP FUNCTION IF EXISTS public.create_product_sale(
  date, text, text, text, uuid, numeric, numeric, numeric, text, date, text, text, text, text, uuid
);

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
  -- dfoms-inv-7a-dual-write
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'Unit price must be zero or greater';
  END IF;

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

-- =============================================================================
-- Dual-write: create_product_purchase — same signature
-- =============================================================================
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

GRANT EXECUTE ON FUNCTION public.create_product_purchase(
  date, uuid, numeric, numeric, uuid, text, text, uuid, uuid, date, date, uuid
) TO authenticated, service_role;

-- =============================================================================
-- Dual-write: create_production_batch — same signature
-- =============================================================================
DROP FUNCTION IF EXISTS public.create_production_batch(
  text, date, uuid, numeric, text, jsonb, date, date
);
DROP FUNCTION IF EXISTS public.create_production_batch(
  text, date, uuid, numeric, text, jsonb, date, date, uuid
);

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
  v_current_stock NUMERIC(18, 4);
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

    SELECT current_stock, average_cost_per_unit, tenant_id
    INTO v_current_stock, v_cost_at_time, v_material_tenant_id
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

    SELECT average_cost_per_unit, tenant_id
    INTO v_cost_at_time, v_material_tenant_id
    FROM raw_materials
    WHERE id = v_material_id;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
