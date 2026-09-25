WITH davors AS (
  SELECT '00000001-0000-4000-8000-000000000001'::uuid AS tenant_id
),
platform_income AS (
  SELECT
    i.id,
    i.date,
    i.invoice_no,
    i.description,
    i.amount,
    i.business_unit_id,
    CASE
      WHEN i.service_category = 'ERP Suite' THEN 'erp_suite_subscription'
      WHEN i.description LIKE 'SMS credit purchase —%' THEN 'platform_sms_credits'
      WHEN i.description LIKE 'Platform-only unit activation —%' THEN 'platform_unit_activation'
      WHEN i.description LIKE 'Platform-only monthly unit billing —%' THEN 'platform_monthly_unit_billing'
      WHEN i.description LIKE 'Platform-only annual unit billing —%' THEN 'platform_annual_unit_billing'
      WHEN i.service_category = 'Platform Billing' THEN 'platform_billing_unclassified'
      ELSE 'platform_income_other'
    END AS stream
  FROM public.income_register i
  CROSS JOIN davors d
  WHERE i.tenant_id = d.tenant_id
    AND i.invoice_no LIKE 'PSK-INC-%'
    AND i.service_category IN ('ERP Suite', 'Platform Billing')
),
platform_expense AS (
  SELECT
    e.id,
    e.date,
    e.receipt_no,
    e.description,
    e.amount,
    e.business_unit_id,
    CASE
      WHEN e.description ILIKE '%ERP Suite subscription%' THEN 'erp_suite_subscription_fee'
      WHEN e.description ILIKE '%SMS credit purchase%' THEN 'platform_sms_credits_fee'
      WHEN e.description ILIKE '%platform unit activation%' THEN 'platform_unit_activation_fee'
      WHEN e.description ILIKE '%platform monthly unit billing%' THEN 'platform_monthly_unit_billing_fee'
      WHEN e.description ILIKE '%platform annual unit billing%' THEN 'platform_annual_unit_billing_fee'
      ELSE 'platform_paystack_fee_unclassified'
    END AS stream
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
),
platform_tax AS (
  SELECT
    t.id,
    t.entry_date AS date,
    t.source_id,
    t.tax_type,
    t.tax_amount AS amount,
    t.business_unit_id,
    pi.stream
  FROM public.tax_ledger_entries t
  INNER JOIN platform_income pi
    ON t.source_type = 'income_register'
   AND t.source_id = pi.id::text
  CROSS JOIN davors d
  WHERE t.tenant_id = d.tenant_id
)
SELECT
  'income_register' AS table_name,
  pi.stream,
  COALESCE(bu.name, 'Untagged') AS business_unit_name,
  count(*)::bigint AS row_count,
  sum(pi.amount)::numeric(18, 2) AS total_amount
FROM platform_income pi
LEFT JOIN public.business_units bu ON bu.id = pi.business_unit_id
GROUP BY pi.stream, COALESCE(bu.name, 'Untagged')
UNION ALL
SELECT
  'expense_register' AS table_name,
  pe.stream,
  COALESCE(bu.name, 'Untagged') AS business_unit_name,
  count(*)::bigint AS row_count,
  sum(pe.amount)::numeric(18, 2) AS total_amount
FROM platform_expense pe
LEFT JOIN public.business_units bu ON bu.id = pe.business_unit_id
GROUP BY pe.stream, COALESCE(bu.name, 'Untagged')
UNION ALL
SELECT
  'tax_ledger_entries' AS table_name,
  pt.stream,
  COALESCE(bu.name, 'Untagged') AS business_unit_name,
  count(*)::bigint AS row_count,
  sum(pt.amount)::numeric(18, 2) AS total_amount
FROM platform_tax pt
LEFT JOIN public.business_units bu ON bu.id = pt.business_unit_id
GROUP BY pt.stream, COALESCE(bu.name, 'Untagged')
ORDER BY table_name, stream, business_unit_name;

WITH davors AS (
  SELECT '00000001-0000-4000-8000-000000000001'::uuid AS tenant_id
),
platform_income AS (
  SELECT
    i.id,
    i.date,
    i.invoice_no,
    i.description,
    i.amount,
    i.business_unit_id,
    CASE
      WHEN i.service_category = 'ERP Suite' THEN 'erp_suite_subscription'
      WHEN i.description LIKE 'SMS credit purchase —%' THEN 'platform_sms_credits'
      WHEN i.description LIKE 'Platform-only unit activation —%' THEN 'platform_unit_activation'
      WHEN i.description LIKE 'Platform-only monthly unit billing —%' THEN 'platform_monthly_unit_billing'
      WHEN i.description LIKE 'Platform-only annual unit billing —%' THEN 'platform_annual_unit_billing'
      WHEN i.service_category = 'Platform Billing' THEN 'platform_billing_unclassified'
      ELSE 'platform_income_other'
    END AS stream
  FROM public.income_register i
  CROSS JOIN davors d
  WHERE i.tenant_id = d.tenant_id
    AND i.invoice_no LIKE 'PSK-INC-%'
    AND i.service_category IN ('ERP Suite', 'Platform Billing')
)
SELECT
  pi.stream,
  pi.id,
  pi.date,
  pi.invoice_no AS reference,
  pi.description,
  pi.amount,
  COALESCE(bu.name, 'Untagged') AS business_unit_name
FROM platform_income pi
LEFT JOIN public.business_units bu ON bu.id = pi.business_unit_id
ORDER BY pi.date, pi.invoice_no;

WITH davors AS (
  SELECT '00000001-0000-4000-8000-000000000001'::uuid AS tenant_id
),
platform_expense AS (
  SELECT
    e.id,
    e.date,
    e.receipt_no,
    e.description,
    e.amount,
    e.business_unit_id,
    CASE
      WHEN e.description ILIKE '%ERP Suite subscription%' THEN 'erp_suite_subscription_fee'
      WHEN e.description ILIKE '%SMS credit purchase%' THEN 'platform_sms_credits_fee'
      WHEN e.description ILIKE '%platform unit activation%' THEN 'platform_unit_activation_fee'
      WHEN e.description ILIKE '%platform monthly unit billing%' THEN 'platform_monthly_unit_billing_fee'
      WHEN e.description ILIKE '%platform annual unit billing%' THEN 'platform_annual_unit_billing_fee'
      ELSE 'platform_paystack_fee_unclassified'
    END AS stream
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
  pe.stream,
  pe.id,
  pe.date,
  pe.receipt_no AS reference,
  pe.description,
  pe.amount,
  COALESCE(bu.name, 'Untagged') AS business_unit_name
FROM platform_expense pe
LEFT JOIN public.business_units bu ON bu.id = pe.business_unit_id
ORDER BY pe.date, pe.receipt_no;

WITH davors AS (
  SELECT '00000001-0000-4000-8000-000000000001'::uuid AS tenant_id
),
platform_income AS (
  SELECT
    i.id,
    i.date,
    i.invoice_no,
    i.description,
    i.amount,
    i.business_unit_id,
    CASE
      WHEN i.service_category = 'ERP Suite' THEN 'erp_suite_subscription'
      WHEN i.description LIKE 'SMS credit purchase —%' THEN 'platform_sms_credits'
      WHEN i.description LIKE 'Platform-only unit activation —%' THEN 'platform_unit_activation'
      WHEN i.description LIKE 'Platform-only monthly unit billing —%' THEN 'platform_monthly_unit_billing'
      WHEN i.description LIKE 'Platform-only annual unit billing —%' THEN 'platform_annual_unit_billing'
      WHEN i.service_category = 'Platform Billing' THEN 'platform_billing_unclassified'
      ELSE 'platform_income_other'
    END AS stream
  FROM public.income_register i
  CROSS JOIN davors d
  WHERE i.tenant_id = d.tenant_id
    AND i.invoice_no LIKE 'PSK-INC-%'
    AND i.service_category IN ('ERP Suite', 'Platform Billing')
),
platform_tax AS (
  SELECT
    t.id,
    t.entry_date AS date,
    t.source_id,
    t.tax_type,
    t.tax_amount AS amount,
    t.business_unit_id,
    pi.stream
  FROM public.tax_ledger_entries t
  INNER JOIN platform_income pi
    ON t.source_type = 'income_register'
   AND t.source_id = pi.id::text
  CROSS JOIN davors d
  WHERE t.tenant_id = d.tenant_id
)
SELECT
  pt.stream,
  pt.id,
  pt.date,
  pt.source_id AS reference,
  pt.tax_type AS description,
  pt.amount,
  COALESCE(bu.name, 'Untagged') AS business_unit_name
FROM platform_tax pt
LEFT JOIN public.business_units bu ON bu.id = pt.business_unit_id
ORDER BY pt.date, pt.id;
