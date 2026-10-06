-- Read-only: products whose BU balance shows stock but have no opening_balance adjustment row.
-- Typical of legacy bulk import that set finished_product_balances directly.
-- Run per environment; do not execute repair DML from this file without review.

SELECT
  fp.tenant_id,
  fp.id AS product_id,
  fp.product_code,
  fp.product_name,
  fpb.business_unit_id,
  fpb.current_stock,
  fpb.average_cost_per_unit
FROM public.finished_products fp
JOIN public.finished_product_balances fpb
  ON fpb.product_id = fp.id
  AND fpb.tenant_id = fp.tenant_id
WHERE fpb.current_stock > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.finished_product_stock_adjustments fsa
    WHERE fsa.product_id = fp.id
      AND fsa.tenant_id = fp.tenant_id
      AND fsa.business_unit_id IS NOT DISTINCT FROM fpb.business_unit_id
      AND fsa.adjustment_type = 'opening_balance'
  )
ORDER BY fp.tenant_id, fp.product_code, fpb.business_unit_id;

-- Proposed repair (manual, per row — not run automatically):
-- 1. Decide true opening qty/cost/dates from business records.
-- 2. Zero incorrect balance if needed via correction/write_off adjustment.
-- 3. Call record_finished_product_manual_adjustment(..., 'opening_balance', qty, cost, ...)
--    with optional manufacturing_date / expiration_date on the adjustment (migration 364+).
