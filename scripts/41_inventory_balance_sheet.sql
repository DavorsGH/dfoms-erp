-- Script 41: Sales & Inventory Phase 5 — inventory on Balance Sheet (go-live forward only)
-- Raw material purchases fund via cash/AP; internal consumption posts to P&L; live inventory asset.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Go-live configuration + opening inventory equity offset
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_balance_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  go_live_date DATE NOT NULL,
  opening_inventory_value NUMERIC(18, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Shared payment-method helpers (cash vs on-account, same naming rules as UI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_payment_method_text(p_method TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(TRIM(COALESCE(p_method, '')), '\s+', ' ', 'g'),
      E'[\u2013\u2014]',
      '-',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION is_credit_payment_method(p_method TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN normalize_payment_method_text(p_method) = '' THEN FALSE
    WHEN normalize_payment_method_text(p_method) ~ '(credit|on account|on-account|accounts payable|supplier credit)'
      THEN TRUE
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION is_cash_payment_method(p_method TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NOT is_credit_payment_method(p_method);
$$;

-- ---------------------------------------------------------------------------
-- 3. Finished product weighted average cost (matches Phase 3/4 COGS logic)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finished_product_weighted_avg_cost(p_product_id UUID)
RETURNS NUMERIC(18, 4)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ROUND(SUM(total_batch_cost) / NULLIF(SUM(quantity_produced), 0), 4),
    0
  )
  FROM production_batches
  WHERE finished_product_id = p_product_id;
$$;

CREATE OR REPLACE FUNCTION calculate_live_inventory_value()
RETURNS NUMERIC(18, 4)
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ROUND(
      (
        SELECT COALESCE(SUM(current_stock * average_cost_per_unit), 0)
        FROM raw_materials
      ) + (
        SELECT COALESCE(
          SUM(
            fp.current_stock * finished_product_weighted_avg_cost(fp.id)
          ),
          0
        )
        FROM finished_products fp
      ),
      4
    ),
    0
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Ensure expense sub-category for internal consumption
-- ---------------------------------------------------------------------------
INSERT INTO expense_subcategories (name)
SELECT 'Cleaning Supplies - Internal Use'
WHERE NOT EXISTS (
  SELECT 1
  FROM expense_subcategories
  WHERE name = 'Cleaning Supplies - Internal Use'
);

-- ---------------------------------------------------------------------------
-- 5. Extend raw_material_purchases for finance linkage
-- ---------------------------------------------------------------------------
ALTER TABLE raw_material_purchases
  ADD COLUMN IF NOT EXISTS accounts_payable_id UUID REFERENCES accounts_payable (id);

UPDATE raw_material_purchases
SET payment_method = 'Cash'
WHERE payment_method IS NULL OR TRIM(payment_method) = '';

ALTER TABLE raw_material_purchases
  ALTER COLUMN payment_method SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Extend internal_consumption for expense linkage
-- ---------------------------------------------------------------------------
ALTER TABLE internal_consumption
  ADD COLUMN IF NOT EXISTS expense_register_id UUID REFERENCES expense_register (id);

-- ---------------------------------------------------------------------------
-- 7. Post raw material purchase to Cash (cash methods) or Accounts Payable (credit)
--    Only for purchases dated on/after go-live.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION post_raw_material_purchase_finance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_go_live DATE;
  v_material_name TEXT;
  v_payable_id UUID;
  v_invoice_no TEXT;
BEGIN
  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  IF v_go_live IS NULL OR NEW.purchase_date < v_go_live THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_method IS NULL OR TRIM(NEW.payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for raw material purchases';
  END IF;

  SELECT material_name
  INTO v_material_name
  FROM raw_materials
  WHERE id = NEW.material_id;

  IF is_credit_payment_method(NEW.payment_method) THEN
    v_invoice_no := 'RMP-' || LEFT(NEW.id::TEXT, 8);

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
      COALESCE(NULLIF(TRIM(NEW.supplier), ''), 'Raw Material Supplier'),
      v_invoice_no,
      'Direct Operational',
      'Raw Materials',
      'Raw material purchase posted to inventory',
      NEW.purchase_date,
      NEW.purchase_date + INTERVAL '30 days',
      NEW.total_cost,
      0,
      NEW.total_cost,
      'Outstanding',
      'Linked to raw_material_purchases ' || NEW.id::TEXT
    )
    RETURNING id INTO v_payable_id;

    UPDATE raw_material_purchases
    SET accounts_payable_id = v_payable_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_post_raw_material_purchase_finance ON raw_material_purchases;

CREATE TRIGGER trg_post_raw_material_purchase_finance
  AFTER INSERT ON raw_material_purchases
  FOR EACH ROW
  EXECUTE FUNCTION post_raw_material_purchase_finance();

-- ---------------------------------------------------------------------------
-- 8. Internal consumption — auto-post P&L expense (non-cash) from go-live forward
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_internal_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_go_live DATE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_unit_cost NUMERIC(18, 4);
  v_expense_amount NUMERIC(18, 4);
  v_expense_id UUID;
BEGIN
  UPDATE finished_products
  SET
    current_stock = current_stock - NEW.quantity,
    updated_at = now()
  WHERE id = NEW.product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
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
    )
  );

  SELECT go_live_date
  INTO v_go_live
  FROM inventory_balance_config
  WHERE id = 1;

  IF v_go_live IS NULL OR NEW.consumption_date < v_go_live THEN
    RETURN NEW;
  END IF;

  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = NEW.product_id;

  v_unit_cost := finished_product_weighted_avg_cost(NEW.product_id);
  v_expense_amount := ROUND(NEW.quantity * v_unit_cost, 4);

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
    NEW.consumption_date,
    'Direct Operational',
    'Cleaning Supplies - Internal Use',
    'Auto-posted internal consumption of ' || v_product_name,
    'Internal',
    v_unit_cost,
    NEW.quantity,
    v_expense_amount,
    'Internal',
    'System',
    'IC-' || LEFT(NEW.id::TEXT, 8),
    'Non-Cash',
    'Linked to internal_consumption ' || NEW.id::TEXT
  )
  RETURNING id INTO v_expense_id;

  UPDATE internal_consumption
  SET expense_register_id = v_expense_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Go-live seed: opening inventory value recorded for equity offset on Balance Sheet
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_opening NUMERIC(18, 4);
BEGIN
  v_opening := calculate_live_inventory_value();

  DELETE FROM inventory_balance_config WHERE id = 1;

  INSERT INTO inventory_balance_config (id, go_live_date, opening_inventory_value)
  VALUES (1, CURRENT_DATE, v_opening);
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
