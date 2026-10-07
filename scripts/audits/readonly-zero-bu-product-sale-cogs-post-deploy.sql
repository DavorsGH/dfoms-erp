-- Read-only (Release 1 post-deploy): product sales on zero-BU tenants should book COGS > 0
-- when the product has cost history. Run on production with read-only credentials.
-- Complement: nightly zero-COGS / integrity job counts should not grow after deploy.

SELECT
  t.slug AS tenant_slug,
  i.id AS income_register_id,
  i.sale_date,
  i.product_id,
  fp.product_code,
  i.quantity,
  i.business_unit_id,
  e.id AS cogs_expense_id,
  e.amount AS cogs_amount,
  e.price AS cogs_unit_price,
  i.created_at
FROM income_register i
JOIN tenants t ON t.id = i.tenant_id
LEFT JOIN finished_products fp ON fp.id = i.product_id
LEFT JOIN expense_register e ON e.id = i.cogs_expense_id
WHERE i.entry_type = 'product_sale'
  AND i.created_at >= now() - interval '7 days'
  AND NOT EXISTS (
    SELECT 1
    FROM business_units bu
    WHERE bu.tenant_id = i.tenant_id
  )
  AND (
    i.cogs_expense_id IS NULL
    OR coalesce(e.amount, 0) <= 0
  )
ORDER BY i.created_at DESC;
