BEGIN;

WITH params AS (
  SELECT (now() AT TIME ZONE 'Africa/Accra')::date AS today_accra
),
active_contracts AS (
  SELECT
    sc.tenant_id,
    sc.id AS contract_id,
    sc.contract_number,
    sc.start_date::date AS start_date,
    sc.end_date::date AS end_date,
    sc.next_billing_date::date AS next_billing_date,
    date_trunc('month', sc.start_date::date)::date AS start_billing_month
  FROM public.supplier_contracts sc
  WHERE sc.status = 'active'
),
start_month_candidates AS (
  SELECT
    ac.*,
    p.today_accra,
    (ac.start_date > ac.start_billing_month) AS starts_after_first_of_month,
    (p.today_accra > ac.start_billing_month) AS start_month_billing_run_passed
  FROM active_contracts ac
  CROSS JOIN params p
  WHERE p.today_accra >= ac.start_date
    AND p.today_accra > ac.start_billing_month
),
expected_start_month_ap AS (
  SELECT
    c.tenant_id,
    c.contract_id,
    c.contract_number,
    c.start_date,
    c.end_date,
    c.start_billing_month,
    c.starts_after_first_of_month,
    c.contract_number || '-' || to_char(c.start_billing_month, 'YYYY-MM') AS expected_invoice_number
  FROM start_month_candidates c
),
missing_start_month_ap AS (
  SELECT
    e.*
  FROM expected_start_month_ap e
  LEFT JOIN public.accounts_payable ap
    ON ap.tenant_id = e.tenant_id
   AND ap.source_type = 'supplier_contract'
   AND ap.source_id = e.contract_id
   AND ap.invoice_number = e.expected_invoice_number
  WHERE ap.id IS NULL
)
SELECT
  tenant_id,
  COUNT(*) AS missing_start_or_prorated_month_bill_count
FROM missing_start_month_ap
GROUP BY tenant_id
ORDER BY tenant_id;

WITH params AS (
  SELECT (now() AT TIME ZONE 'Africa/Accra')::date AS today_accra
),
active_contracts AS (
  SELECT
    sc.tenant_id,
    sc.id AS contract_id,
    sc.contract_number,
    sc.start_date::date AS start_date,
    sc.end_date::date AS end_date,
    sc.next_billing_date::date AS next_billing_date,
    date_trunc('month', sc.start_date::date)::date AS start_billing_month
  FROM public.supplier_contracts sc
  WHERE sc.status = 'active'
),
start_month_candidates AS (
  SELECT
    ac.*,
    p.today_accra,
    (ac.start_date > ac.start_billing_month) AS starts_after_first_of_month,
    (p.today_accra > ac.start_billing_month) AS start_month_billing_run_passed
  FROM active_contracts ac
  CROSS JOIN params p
  WHERE p.today_accra >= ac.start_date
    AND p.today_accra > ac.start_billing_month
),
expected_start_month_ap AS (
  SELECT
    c.tenant_id,
    c.contract_id,
    c.contract_number,
    c.start_date,
    c.end_date,
    c.start_billing_month,
    c.starts_after_first_of_month,
    c.contract_number || '-' || to_char(c.start_billing_month, 'YYYY-MM') AS expected_invoice_number
  FROM start_month_candidates c
),
missing_start_month_ap AS (
  SELECT
    e.*
  FROM expected_start_month_ap e
  LEFT JOIN public.accounts_payable ap
    ON ap.tenant_id = e.tenant_id
   AND ap.source_type = 'supplier_contract'
   AND ap.source_id = e.contract_id
   AND ap.invoice_number = e.expected_invoice_number
  WHERE ap.id IS NULL
)
SELECT
  COUNT(*) AS total_missing_start_or_prorated_month_bill_count
FROM missing_start_month_ap;

COMMIT;
