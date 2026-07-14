-- Script 39: Sales & Inventory Phase 2 — internal consumption
-- Records finished product drawn for Davors' own cleaning contract use.
-- Does NOT integrate with Finance, Payroll, or Balance Sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. internal_consumption
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS internal_consumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES finished_products (id),
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  consumption_date DATE NOT NULL,
  reason TEXT,
  recorded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Validate stock before insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_internal_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_stock NUMERIC(18, 4);
  v_product_name TEXT;
  v_unit_of_measure TEXT;
BEGIN
  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  SELECT current_stock, product_name, unit_of_measure
  INTO v_current_stock, v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = NEW.product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  IF v_current_stock < NEW.quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot record use of %',
      v_current_stock,
      v_unit_of_measure,
      v_product_name,
      NEW.quantity;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_internal_consumption ON internal_consumption;

CREATE TRIGGER trg_validate_internal_consumption
  BEFORE INSERT ON internal_consumption
  FOR EACH ROW
  EXECUTE FUNCTION validate_internal_consumption();

-- ---------------------------------------------------------------------------
-- 3. Apply stock decrease + stock_movements ledger on insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_internal_consumption()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_internal_consumption ON internal_consumption;

CREATE TRIGGER trg_apply_internal_consumption
  AFTER INSERT ON internal_consumption
  FOR EACH ROW
  EXECUTE FUNCTION apply_internal_consumption();

COMMIT;

NOTIFY pgrst, 'reload schema';
