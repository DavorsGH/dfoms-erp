WITH davors AS (
  SELECT '00000001-0000-4000-8000-000000000001'::uuid AS tenant_id
),
platform_income AS (
  SELECT i.amount, i.business_unit_id
  FROM public.income_register i
  CROSS JOIN davors d
  WHERE i.tenant_id = d.tenant_id
    AND i.invoice_no LIKE 'PSK-INC-%'
    AND i.service_category IN ('ERP Suite', 'Platform Billing')
),
platform_expense AS (
  SELECT e.amount, e.business_unit_id
  FROM public.expense_register e
  CROSS JOIN davors d
  WHERE e.tenant_id = d.tenant_id
    AND e.receipt_no LIKE 'PSK-FEE-%'
    AND e.expense_category = 'Direct Operational'
    AND e.sub_category = 'Paystack Transaction Fees'
    AND e.vendor = 'Paystack'
    AND (
      e.description ILIKE '%ERP Suite subscription%'
      OR e.description ILIKE '%SMS credit purchase%'
      OR e.description ILIKE '%platform unit activation%'
      OR e.description ILIKE '%platform monthly unit billing%'
      OR e.description ILIKE '%platform annual unit billing%'
    )
)
SELECT
  'income_register'::text AS table_name,
  COALESCE(bu.name, 'Untagged') AS business_unit_name,
  count(*)::bigint AS row_count,
  sum(pi.amount)::numeric(18, 2) AS total_amount
FROM platform_income pi
LEFT JOIN public.business_units bu ON bu.id = pi.business_unit_id
GROUP BY COALESCE(bu.name, 'Untagged')
UNION ALL
SELECT
  'expense_register'::text AS table_name,
  COALESCE(bu.name, 'Untagged') AS business_unit_name,
  count(*)::bigint AS row_count,
  sum(pe.amount)::numeric(18, 2) AS total_amount
FROM platform_expense pe
LEFT JOIN public.business_units bu ON bu.id = pe.business_unit_id
GROUP BY COALESCE(bu.name, 'Untagged')
ORDER BY table_name, business_unit_name;
