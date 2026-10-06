SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  count(*) AS zero_cogs_sale_lines,
  sum(coalesce(ir.sale_quantity, 0)) AS zero_cogs_units,
  round(sum(coalesce(ir.amount, 0)), 2) AS zero_cogs_revenue
FROM public.income_register ir
JOIN public.tenants t ON t.id = ir.tenant_id
LEFT JOIN public.expense_register er ON er.id = ir.cogs_expense_id
WHERE ir.entry_type = 'product_sale'
  AND coalesce(ir.sale_status, 'active') <> 'voided'
  AND coalesce(ir.is_sale_return, false) = false
  AND coalesce(ir.sale_quantity, 0) > 0
  AND (
    ir.cogs_expense_id IS NULL
    OR coalesce(er.amount, 0) = 0
  )
GROUP BY t.id, t.name
ORDER BY t.name;

SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  ir.invoice_no,
  ir.date,
  ir.sale_quantity,
  ir.amount AS revenue,
  coalesce(er.amount, 0) AS booked_cogs,
  fp.product_code,
  bu.name AS business_unit_name
FROM public.income_register ir
JOIN public.tenants t ON t.id = ir.tenant_id
LEFT JOIN public.expense_register er ON er.id = ir.cogs_expense_id
LEFT JOIN public.finished_products fp ON fp.id = ir.product_id
LEFT JOIN public.business_units bu ON bu.id = ir.business_unit_id
WHERE ir.entry_type = 'product_sale'
  AND coalesce(ir.sale_status, 'active') <> 'voided'
  AND coalesce(ir.is_sale_return, false) = false
  AND coalesce(ir.sale_quantity, 0) > 0
  AND (
    ir.cogs_expense_id IS NULL
    OR coalesce(er.amount, 0) = 0
  )
ORDER BY t.name, ir.date, ir.invoice_no;
