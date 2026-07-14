-- Script 38: Sales & Inventory Phase 1 — schema foundation
-- Raw materials, purchases, finished products, production batches, stock movements.
-- Does NOT integrate with Expense Register or Balance Sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum: finished product stock movement types
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
    CREATE TYPE stock_movement_type AS ENUM (
      'production_in',
      'sale_out',
      'internal_consumption_out',
      'adjustment'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. raw_materials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit_of_measure TEXT NOT NULL,
  current_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
  average_cost_per_unit NUMERIC(18, 4) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(18, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raw_materials_material_code_key'
  ) THEN
    ALTER TABLE raw_materials
      ADD CONSTRAINT raw_materials_material_code_key UNIQUE (material_code);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. raw_material_purchases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_material_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES raw_materials (id),
  purchase_date DATE NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  cost_per_unit NUMERIC(18, 4) NOT NULL CHECK (cost_per_unit >= 0),
  total_cost NUMERIC(18, 4) NOT NULL,
  supplier TEXT,
  payment_method TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION apply_raw_material_purchase()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_stock NUMERIC(18, 4);
  v_old_avg NUMERIC(18, 4);
  v_new_stock NUMERIC(18, 4);
  v_new_avg NUMERIC(18, 4);
BEGIN
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 4);

  SELECT current_stock, average_cost_per_unit
  INTO v_old_stock, v_old_avg
  FROM raw_materials
  WHERE id = NEW.material_id
  FOR UPDATE;

  v_new_stock := v_old_stock + NEW.quantity;

  IF v_new_stock = 0 THEN
    v_new_avg := NEW.cost_per_unit;
  ELSE
    v_new_avg :=
      ROUND(
        (
          (v_old_stock * v_old_avg) + (NEW.quantity * NEW.cost_per_unit)
        ) / v_new_stock,
        4
      );
  END IF;

  UPDATE raw_materials
  SET
    current_stock = v_new_stock,
    average_cost_per_unit = v_new_avg,
    updated_at = now()
  WHERE id = NEW.material_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_raw_material_purchase ON raw_material_purchases;

CREATE TRIGGER trg_apply_raw_material_purchase
  BEFORE INSERT ON raw_material_purchases
  FOR EACH ROW
  EXECUTE FUNCTION apply_raw_material_purchase();

-- ---------------------------------------------------------------------------
-- 3. finished_products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finished_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  unit_of_measure TEXT NOT NULL,
  current_stock NUMERIC(18, 4) NOT NULL DEFAULT 0,
  standard_selling_price NUMERIC(18, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'finished_products_product_code_key'
  ) THEN
    ALTER TABLE finished_products
      ADD CONSTRAINT finished_products_product_code_key UNIQUE (product_code);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. production_batches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number TEXT NOT NULL,
  production_date DATE NOT NULL,
  finished_product_id UUID NOT NULL REFERENCES finished_products (id),
  quantity_produced NUMERIC(18, 4) NOT NULL CHECK (quantity_produced > 0),
  cost_per_unit_produced NUMERIC(18, 4) NOT NULL DEFAULT 0,
  total_batch_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_batches_batch_number_key'
  ) THEN
    ALTER TABLE production_batches
      ADD CONSTRAINT production_batches_batch_number_key UNIQUE (batch_number);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. production_batch_materials
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_batch_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES production_batches (id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES raw_materials (id),
  quantity_used NUMERIC(18, 4) NOT NULL CHECK (quantity_used > 0),
  cost_at_time NUMERIC(18, 4) NOT NULL CHECK (cost_at_time >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_batch_materials_batch_material_key'
  ) THEN
    ALTER TABLE production_batch_materials
      ADD CONSTRAINT production_batch_materials_batch_material_key
      UNIQUE (batch_id, material_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. stock_movements (append-only ledger)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES finished_products (id),
  movement_type stock_movement_type NOT NULL,
  quantity NUMERIC(18, 4) NOT NULL CHECK (quantity > 0),
  reference_id UUID,
  movement_date DATE NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RPC: create production batch atomically
-- p_materials JSON array: [{ "material_id": "uuid", "quantity_used": number }]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_production_batch(
  p_batch_number TEXT,
  p_production_date DATE,
  p_finished_product_id UUID,
  p_quantity_produced NUMERIC,
  p_notes TEXT,
  p_materials JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
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

  -- Validate stock and accumulate cost before writing
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
    notes
  )
  VALUES (
    p_batch_number,
    p_production_date,
    p_finished_product_id,
    p_quantity_produced,
    v_cost_per_unit,
    v_total_batch_cost,
    p_notes
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
      batch_id,
      material_id,
      quantity_used,
      cost_at_time
    )
    VALUES (
      v_batch_id,
      v_material_id,
      v_quantity_used,
      v_cost_at_time
    );

    UPDATE raw_materials
    SET
      current_stock = current_stock - v_quantity_used,
      updated_at = now()
    WHERE id = v_material_id;
  END LOOP;

  UPDATE finished_products
  SET
    current_stock = current_stock + p_quantity_produced,
    updated_at = now()
  WHERE id = p_finished_product_id;

  INSERT INTO stock_movements (
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes
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
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
