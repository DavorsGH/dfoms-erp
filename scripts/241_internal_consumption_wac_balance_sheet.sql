-- Script 241: Internal consumption in finished-product WAC + BS carrying value
--
-- Extends script 145 identity:
--   WAC = (production + purchases − product_sale_COGS − internal_consumption_value) / current_stock
-- where internal_consumption_value = SUM(expense_register.amount) linked via
-- internal_consumption.expense_register_id (post-go-live rows only — pre-go-live has no expense).
--
-- Also fixes apply_internal_consumption(): compute WAC before stock reduction (match create_product_sale).
-- Renames expense sub-category to Finished Goods - Internal Use (platform-wide data migration).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Expense sub-category (new per tenant + migrate legacy rows)
-- ---------------------------------------------------------------------------
INSERT INTO public.expense_subcategories (name, tenant_id)
SELECT 'Finished Goods - Internal Use', t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expense_subcategories es
  WHERE es.name = 'Finished Goods - Internal Use'
    AND es.tenant_id = t.id
);

UPDATE expense_register
SET sub_category = 'Finished Goods - Internal Use'
WHERE sub_category = 'Cleaning Supplies - Internal Use';

-- ---------------------------------------------------------------------------
-- 2. finished_product_weighted_avg_cost — subtract internal-consumption value
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finished_product_weighted_avg_cost(p_product_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(
    ROUND(
      (
        COALESCE((
          SELECT SUM(pb.total_batch_cost)
          FROM production_batches pb
          WHERE pb.finished_product_id = p_product_id
        ), 0)
        + COALESCE((
          SELECT SUM(pp.total_cost)
          FROM product_purchases pp
          WHERE pp.product_id = p_product_id
        ), 0)
        - COALESCE((
          SELECT SUM(e.amount)
          FROM income_register i
          JOIN expense_register e
            ON e.id = i.cogs_expense_id
            OR e.id = i.cogs_reversal_expense_id
          WHERE i.product_id = p_product_id
            AND i.entry_type = 'product_sale'
        ), 0)
        - COALESCE((
          SELECT SUM(e.amount)
          FROM internal_consumption ic
          JOIN expense_register e ON e.id = ic.expense_register_id
          WHERE ic.product_id = p_product_id
        ), 0)
      ) / NULLIF((
        SELECT fp.current_stock
        FROM finished_products fp
        WHERE fp.id = p_product_id
      ), 0),
      4
    ),
    0
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3. apply_internal_consumption — WAC before stock reduction; new sub-category
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
    notes
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
    'Linked to internal_consumption ' || NEW.id::TEXT
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
