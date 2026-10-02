WITH params AS (
  SELECT (now() AT TIME ZONE 'Africa/Accra')::date AS today_accra
),
candidates AS (
  SELECT
    sc.tenant_id,
    sc.id AS contract_id,
    sc.contract_number,
    sc.start_date::date AS start_date,
    sc.end_date::date AS end_date,
    date_trunc('month', sc.start_date::date)::date AS start_billing_month,
    sc.contract_number || '-' || to_char(date_trunc('month', sc.start_date::date), 'YYYY-MM') AS expected_invoice_number
  FROM public.supplier_contracts sc
  CROSS JOIN params p
  WHERE sc.status = 'active'
    AND p.today_accra >= sc.start_date::date
    AND p.today_accra > date_trunc('month', sc.start_date::date)::date
)
SELECT
  t.name AS tenant_name,
  c.contract_number,
  c.start_date,
  c.end_date,
  c.expected_invoice_number,
  (c.start_date > c.start_billing_month) AS starts_after_first_of_month
FROM candidates c
LEFT JOIN public.tenants t ON t.id = c.tenant_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.accounts_payable ap
  WHERE ap.tenant_id = c.tenant_id
    AND ap.source_type = 'supplier_contract'
    AND ap.source_id = c.contract_id::text
    AND ap.invoice_number = c.expected_invoice_number
)
ORDER BY t.name, c.contract_number;
