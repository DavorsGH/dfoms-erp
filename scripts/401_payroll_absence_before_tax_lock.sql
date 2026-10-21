-- Open payroll periods from October 2026 book salary expense on earned gross
-- (absence already removed). Deduction-savings income must not also include
-- absence, or the Balance Sheet is credited twice.
-- Months before October 2026 keep absence in deduction savings.
-- Replacing this function does not rewrite journals already posted.

BEGIN;

CREATE OR REPLACE FUNCTION public._payroll_deduction_savings_total(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_rows jsonb
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT public._payroll_round_currency(
    coalesce(
      (
        SELECT sum(
          CASE
            WHEN p_payroll_month >= DATE '2026-10-01' THEN 0
            ELSE coalesce((elem ->> 'absence_deduction')::numeric, 0)
          END
          + coalesce((elem ->> 'loan_repayment')::numeric, 0)
          + coalesce((elem ->> 'other_deductions')::numeric, 0)
          + greatest(
              0,
              coalesce((elem ->> 'salary_advance')::numeric, 0)
              - coalesce(
                  (
                    SELECT sum(sar.amount)
                    FROM public.salary_advance_register sar
                    WHERE sar.tenant_id = p_tenant_id
                      AND sar.employee_id = trim(elem ->> 'employee_id')
                      AND sar.deduct_payroll_month = p_payroll_month
                      AND sar.status = 'outstanding'
                      AND sar.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
                  ),
                  0
                )
            )
        )
        FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
      ),
      0
    )
  );
$$;

COMMIT;
