-- Read-only: finished_products.current_stock vs SUM(finished_product_balances.current_stock) per product.
SELECT
  fp.tenant_id,
  t.name AS tenant_name,
  fp.id AS product_id,
  fp.product_code,
  fp.product_name,
  fp.current_stock AS master_current_stock,
  COALESCE(bal.sum_stock, 0) AS balances_sum,
  fp.current_stock - COALESCE(bal.sum_stock, 0) AS master_minus_balances
FROM public.finished_products fp
JOIN public.tenants t ON t.id = fp.tenant_id
LEFT JOIN (
  SELECT
    tenant_id,
    product_id,
    SUM(current_stock)::numeric(18, 4) AS sum_stock
  FROM public.finished_product_balances
  GROUP BY tenant_id, product_id
) bal
  ON bal.tenant_id = fp.tenant_id
 AND bal.product_id = fp.id
WHERE fp.current_stock IS DISTINCT FROM COALESCE(bal.sum_stock, 0)
ORDER BY t.name, fp.product_code;
