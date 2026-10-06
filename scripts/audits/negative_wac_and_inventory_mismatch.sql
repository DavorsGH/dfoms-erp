SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  fpb.business_unit_id,
  bu.name AS business_unit_name,
  fp.product_code,
  fp.product_name,
  fpb.current_stock,
  fpb.average_cost_per_unit,
  round(fpb.current_stock * fpb.average_cost_per_unit, 2) AS balance_value
FROM public.finished_product_balances fpb
JOIN public.finished_products fp ON fp.id = fpb.product_id
JOIN public.tenants t ON t.id = fpb.tenant_id
LEFT JOIN public.business_units bu ON bu.id = fpb.business_unit_id
WHERE fpb.current_stock > 0
  AND coalesce(fpb.average_cost_per_unit, 0) <= 0
ORDER BY t.name, bu.name, fp.product_code;

SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  rmb.business_unit_id,
  bu.name AS business_unit_name,
  rm.material_code,
  rm.material_name,
  rmb.current_stock,
  rmb.average_cost_per_unit,
  round(rmb.current_stock * rmb.average_cost_per_unit, 2) AS balance_value
FROM public.raw_material_balances rmb
JOIN public.raw_materials rm ON rm.id = rmb.material_id
JOIN public.tenants t ON t.id = rmb.tenant_id
LEFT JOIN public.business_units bu ON bu.id = rmb.business_unit_id
WHERE rmb.current_stock > 0
  AND coalesce(rmb.average_cost_per_unit, 0) <= 0
ORDER BY t.name, bu.name, rm.material_code;

SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  fpb.business_unit_id,
  fp.product_code,
  fpb.current_stock,
  fpb.average_cost_per_unit AS stored_wac,
  public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id) AS formula_wac
FROM public.finished_product_balances fpb
JOIN public.finished_products fp ON fp.id = fpb.product_id
JOIN public.tenants t ON t.id = fpb.tenant_id
WHERE abs(
  coalesce(fpb.average_cost_per_unit, 0)
  - coalesce(public.finished_product_weighted_avg_cost_scoped(fp.id, fpb.business_unit_id), 0)
) > 0.01
ORDER BY t.name, fp.product_code;
