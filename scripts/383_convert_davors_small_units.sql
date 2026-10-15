BEGIN;

CREATE TEMP TABLE _conv_materials ON COMMIT DROP AS
SELECT
  rm.id,
  rm.material_code,
  rm.material_name,
  lower(trim(rm.unit_of_measure)) AS old_unit_key,
  rm.current_stock,
  rm.average_cost_per_unit,
  CASE
    WHEN lower(trim(rm.unit_of_measure)) = 'g' THEN 'kg'
    WHEN lower(trim(rm.unit_of_measure)) = 'ml' THEN 'litre'
  END AS new_unit
FROM public.raw_materials rm
WHERE rm.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND lower(trim(rm.unit_of_measure)) IN ('g', 'ml');

CREATE TABLE public.backup_20261015_unit_conv_raw_materials AS
SELECT rm.* FROM public.raw_materials rm
WHERE rm.id IN (SELECT id FROM _conv_materials);

CREATE TABLE public.backup_20261015_unit_conv_raw_material_purchases AS
SELECT rmp.* FROM public.raw_material_purchases rmp
WHERE rmp.material_id IN (SELECT id FROM _conv_materials);

CREATE TABLE public.backup_20261015_unit_conv_raw_material_balances AS
SELECT rmb.* FROM public.raw_material_balances rmb
WHERE rmb.material_id IN (SELECT id FROM _conv_materials);

CREATE TABLE public.backup_20261015_unit_conv_raw_material_stock_adjustments AS
SELECT rmsa.* FROM public.raw_material_stock_adjustments rmsa
WHERE rmsa.material_id IN (SELECT id FROM _conv_materials);

CREATE TABLE public.backup_20261015_unit_conv_production_batch_materials AS
SELECT pbm.* FROM public.production_batch_materials pbm
WHERE pbm.material_id IN (SELECT id FROM _conv_materials);

CREATE TABLE public.backup_20261015_unit_conv_purchase_order_items AS
SELECT poi.* FROM public.purchase_order_items poi
WHERE poi.raw_material_id IN (SELECT id FROM _conv_materials);

UPDATE public.raw_material_purchases rmp
SET quantity = ROUND(rmp.quantity / 1000, 4),
    cost_per_unit = ROUND(rmp.cost_per_unit * 1000, 4)
WHERE rmp.material_id IN (SELECT id FROM _conv_materials);

UPDATE public.raw_material_balances rmb
SET current_stock = ROUND(rmb.current_stock / 1000, 4),
    average_cost_per_unit = ROUND(rmb.average_cost_per_unit * 1000, 4),
    updated_at = now()
WHERE rmb.material_id IN (SELECT id FROM _conv_materials);

UPDATE public.raw_material_stock_adjustments rmsa
SET quantity_delta = ROUND(rmsa.quantity_delta / 1000, 4),
    cost_per_unit = ROUND(rmsa.cost_per_unit * 1000, 4)
WHERE rmsa.material_id IN (SELECT id FROM _conv_materials);

UPDATE public.production_batch_materials pbm
SET quantity_used = ROUND(pbm.quantity_used / 1000, 4),
    cost_at_time = ROUND(pbm.cost_at_time * 1000, 4)
WHERE pbm.material_id IN (SELECT id FROM _conv_materials);

UPDATE public.purchase_order_items poi
SET quantity_ordered = ROUND(poi.quantity_ordered / 1000, 4),
    quantity_received = CASE WHEN poi.quantity_received IS NULL THEN NULL ELSE ROUND(poi.quantity_received / 1000, 4) END,
    unit_cost = ROUND(poi.unit_cost * 1000, 4)
WHERE poi.raw_material_id IN (SELECT id FROM _conv_materials);

UPDATE public.raw_materials rm
SET current_stock = ROUND(rm.current_stock / 1000, 4),
    average_cost_per_unit = ROUND(rm.average_cost_per_unit * 1000, 4),
    unit_of_measure = cm.new_unit,
    updated_at = now()
FROM _conv_materials cm
WHERE rm.id = cm.id;

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_raw_materials b
  JOIN public.raw_materials rm ON rm.id = b.id
  WHERE abs(COALESCE(b.current_stock, 0) / 1000 - COALESCE(rm.current_stock, 0)) > 0.00005
     OR abs(COALESCE(b.current_stock * b.average_cost_per_unit, 0) - COALESCE(rm.current_stock * rm.average_cost_per_unit, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % raw_materials rows changed quantity or value beyond rounding', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_raw_material_purchases b
  JOIN public.raw_material_purchases p ON p.id = b.id
  WHERE abs(COALESCE(b.quantity, 0) / 1000 - COALESCE(p.quantity, 0)) > 0.00005
     OR abs(COALESCE(b.quantity * b.cost_per_unit, 0) - COALESCE(p.quantity * p.cost_per_unit, 0)) > 0.01
     OR COALESCE(b.total_cost, 0) <> COALESCE(p.total_cost, 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % purchase rows changed quantity, value or total_cost', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_raw_material_balances b
  JOIN public.raw_material_balances rb
    ON rb.material_id = b.material_id
   AND rb.business_unit_id IS NOT DISTINCT FROM b.business_unit_id
  WHERE abs(COALESCE(b.current_stock, 0) / 1000 - COALESCE(rb.current_stock, 0)) > 0.00005
     OR abs(COALESCE(b.current_stock * b.average_cost_per_unit, 0) - COALESCE(rb.current_stock * rb.average_cost_per_unit, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % balance rows changed quantity or value beyond rounding', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_raw_material_stock_adjustments b
  JOIN public.raw_material_stock_adjustments a ON a.id = b.id
  WHERE abs(COALESCE(b.quantity_delta, 0) / 1000 - COALESCE(a.quantity_delta, 0)) > 0.00005
     OR abs(COALESCE(b.quantity_delta * b.cost_per_unit, 0) - COALESCE(a.quantity_delta * a.cost_per_unit, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % adjustment rows changed quantity or value beyond rounding', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_production_batch_materials b
  JOIN public.production_batch_materials m
    ON m.batch_id = b.batch_id
   AND m.material_id = b.material_id
  WHERE abs(COALESCE(b.quantity_used, 0) / 1000 - COALESCE(m.quantity_used, 0)) > 0.00005
     OR abs(COALESCE(b.quantity_used * b.cost_at_time, 0) - COALESCE(m.quantity_used * m.cost_at_time, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % production batch material rows changed quantity or value beyond rounding', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.backup_20261015_unit_conv_purchase_order_items b
  JOIN public.purchase_order_items i ON i.id = b.id
  WHERE abs(COALESCE(b.quantity_ordered * b.unit_cost, 0) - COALESCE(i.quantity_ordered * i.unit_cost, 0)) > 0.01;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Abort: % purchase order lines changed value beyond rounding', v_bad;
  END IF;
END $$;

SELECT
  b.material_code,
  b.material_name,
  b.unit_of_measure AS unit_before,
  rm.unit_of_measure AS unit_after,
  b.current_stock AS stock_before,
  rm.current_stock AS stock_after,
  b.average_cost_per_unit AS avg_cost_before,
  rm.average_cost_per_unit AS avg_cost_after,
  ROUND(b.current_stock * b.average_cost_per_unit, 2) AS value_before,
  ROUND(rm.current_stock * rm.average_cost_per_unit, 2) AS value_after,
  (SELECT count(*) FROM public.backup_20261015_unit_conv_raw_material_purchases p WHERE p.material_id = b.id) AS purchases_converted,
  (SELECT count(*) FROM public.backup_20261015_unit_conv_production_batch_materials m WHERE m.material_id = b.id) AS batch_lines_converted,
  (SELECT count(*) FROM public.backup_20261015_unit_conv_raw_material_stock_adjustments a WHERE a.material_id = b.id) AS adjustments_converted
FROM public.backup_20261015_unit_conv_raw_materials b
JOIN public.raw_materials rm ON rm.id = b.id
ORDER BY b.material_code;

COMMIT;
