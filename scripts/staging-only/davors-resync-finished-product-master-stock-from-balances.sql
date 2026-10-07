-- Staging-only: realign finished_products.current_stock to sum(finished_product_balances).
-- Use after removing phantom NULL-BU balance rows (e.g. SKU-1003 +3 drift).
BEGIN;

UPDATE public.finished_products fp
SET
  current_stock = COALESCE(b.sum_stock, 0),
  updated_at = now()
FROM (
  SELECT
    product_id,
    SUM(current_stock)::numeric(18, 4) AS sum_stock
  FROM public.finished_product_balances
  WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  GROUP BY product_id
) b
WHERE fp.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND fp.id = b.product_id
  AND fp.current_stock IS DISTINCT FROM b.sum_stock;

COMMIT;
