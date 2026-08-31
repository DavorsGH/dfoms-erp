-- Script 267: Phase 7b step 1 — stamp business_unit_id through IC trigger side-effects
-- Prerequisite: script 264 added business_unit_id on internal_consumption + stock_movements;
--   expense_register.business_unit_id already exists from earlier finance BU work.
-- Propagates NEW.business_unit_id (app-stamped on insert) to stock_movements and
-- expense_register. Does not change WAC / dual-write balance logic (later 7b steps).

BEGIN;

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
    v_unit_cost := finished_product_weighted_avg_cost(NEW.product_id);
    v_expense_amount := ROUND(NEW.quantity * v_unit_cost, 4);
  END IF;

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
