SELECT fp.product_code, fpb.business_unit_id, bu.name AS bu_name, fpb.current_stock, fpb.average_cost_per_unit AS stored_wac, public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id) AS formula_wac, round(fpb.current_stock * fpb.average_cost_per_unit, 2) AS stored_value, round(fpb.current_stock * coalesce(public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id), 0), 2) AS formula_value
FROM public.finished_product_balances fpb
JOIN public.finished_products fp ON fp.id = fpb.product_id
JOIN public.tenants t ON t.id = fpb.tenant_id
LEFT JOIN public.business_units bu ON bu.id = fpb.business_unit_id
WHERE t.name ILIKE '%Davors%'
  AND fp.product_code IN ('CAN-FP-0004', 'SKU-1003', 'VOID-DATE-TEST');

SELECT 'finished_product_balances' AS tbl, count(*) AS null_bu_rows
FROM public.finished_product_balances fpb
JOIN public.tenants t ON t.id = fpb.tenant_id
WHERE t.name ILIKE '%Davors%' AND fpb.business_unit_id IS NULL AND coalesce(fpb.current_stock, 0) <> 0
UNION ALL
SELECT 'raw_material_balances', count(*)
FROM public.raw_material_balances rmb
JOIN public.tenants t ON t.id = rmb.tenant_id
WHERE t.name ILIKE '%Davors%' AND rmb.business_unit_id IS NULL AND coalesce(rmb.current_stock, 0) <> 0;

SELECT fp.product_code, fpb.business_unit_id, fpb.current_stock, fpb.average_cost_per_unit
FROM public.finished_product_balances fpb
JOIN public.finished_products fp ON fp.id = fpb.product_id
JOIN public.tenants t ON t.id = fpb.tenant_id
WHERE t.name ILIKE '%Davors%' AND fpb.business_unit_id IS NULL AND coalesce(fpb.current_stock, 0) <> 0;
