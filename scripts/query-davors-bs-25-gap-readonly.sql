\set tenant_id '00000001-0000-4000-8000-000000000001'

SELECT go_live_date, opening_inventory_value
FROM public.inventory_balance_config
WHERE tenant_id = :'tenant_id'::uuid;

SELECT
  round(sum(quantity_delta * cost_per_unit), 2) AS fp_adj_value_total,
  count(*) AS fp_adj_count
FROM public.finished_product_stock_adjustments
WHERE tenant_id = :'tenant_id'::uuid;

SELECT
  fsa.id,
  fp.product_code,
  fsa.adjustment_type,
  fsa.quantity_delta,
  fsa.cost_per_unit,
  round(fsa.quantity_delta * fsa.cost_per_unit, 2) AS value,
  fsa.created_at::date AS adj_date
FROM public.finished_product_stock_adjustments fsa
JOIN public.finished_products fp ON fp.id = fsa.product_id
WHERE fsa.tenant_id = :'tenant_id'::uuid
ORDER BY fsa.created_at DESC;

SELECT
  round(sum(quantity_delta * coalesce(cost_per_unit, 0)), 2) AS rm_adj_value_total
FROM public.raw_material_stock_adjustments
WHERE tenant_id = :'tenant_id'::uuid;

SELECT id, invoice_no, date, amount, entry_type, sale_status, description
FROM public.income_register
WHERE tenant_id = :'tenant_id'::uuid
  AND (
    abs(amount - 25) < 0.01
    OR description ILIKE '%POS%'
    OR invoice_no ILIKE 'DF-POS%'
  )
ORDER BY date;

SELECT id, receipt_no, date, amount, description, notes
FROM public.expense_register
WHERE tenant_id = :'tenant_id'::uuid
  AND abs(amount - 25) < 0.01
ORDER BY date;

SELECT er.id, er.receipt_no, er.amount, er.description, ir.invoice_no, ir.sale_status
FROM public.income_register ir
LEFT JOIN public.expense_register er ON er.id = ir.cogs_expense_id
WHERE ir.tenant_id = :'tenant_id'::uuid
  AND ir.entry_type = 'product_sale'
  AND (
    abs(ir.amount - 25) < 0.01
    OR abs(coalesce(er.amount, 0) - 25) < 0.01
  );

SELECT fp.id, fp.product_code, fp.product_name, fp.current_stock, fp.deleted_at
FROM public.finished_products fp
WHERE fp.tenant_id = :'tenant_id'::uuid
  AND (
    fp.product_code ILIKE '%polish%'
    OR fp.product_name ILIKE '%polish%'
    OR NOT EXISTS (SELECT 1 FROM public.finished_products fp2 WHERE fp2.id = fp.id)
  );

SELECT sm.id, sm.product_id, fp.product_code, sm.movement_type, sm.quantity, sm.movement_date, sm.notes
FROM public.stock_movements sm
LEFT JOIN public.finished_products fp ON fp.id = sm.product_id
WHERE fp.tenant_id = :'tenant_id'::uuid
   OR sm.product_id NOT IN (SELECT id FROM public.finished_products WHERE tenant_id = :'tenant_id'::uuid);

SELECT fpb.product_id, fp.product_code, fpb.current_stock, fpb.average_cost_per_unit,
       round(fpb.current_stock * fpb.average_cost_per_unit, 2) AS balance_value
FROM public.finished_product_balances fpb
JOIN public.finished_products fp ON fp.id = fpb.product_id
WHERE fpb.tenant_id = :'tenant_id'::uuid
  AND abs(round(fpb.current_stock * fpb.average_cost_per_unit, 2) - 25) < 0.01;
