SELECT
  es.tenant_id,
  es.name,
  es.is_active
FROM public.expense_subcategories es
WHERE es.expense_category IS NULL
ORDER BY es.tenant_id, es.name;
