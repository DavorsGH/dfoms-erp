SELECT
  tenant_id,
  stage,
  payroll_month,
  employee_id,
  allowance_type_id,
  allowance_code,
  allowance_name,
  amount,
  business_unit_id
FROM public.payroll_allowance_lines
WHERE tenant_id = :tenant_id
  AND stage = 'processing'
  AND payroll_month = DATE '2026-10-01'
ORDER BY employee_id ASC, allowance_code ASC;
