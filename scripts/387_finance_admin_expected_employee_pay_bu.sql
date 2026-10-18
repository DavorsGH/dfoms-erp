BEGIN;

CREATE OR REPLACE FUNCTION public.finance_admin_expected_employee_pay(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_position text,
  p_employment_type text,
  p_shift text
)
RETURNS TABLE (
  basic_salary numeric,
  housing_allowance numeric,
  transport_allowance numeric,
  other_allowances numeric,
  welfare_deduction_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos text := nullif(btrim(p_position), '');
  v_emp text := nullif(btrim(p_employment_type), '');
  v_shift text := nullif(btrim(p_shift), '');
  v_basic numeric := 0;
  v_housing numeric := 0;
  v_transport numeric := 0;
  v_other numeric := 0;
  v_welfare numeric := NULL;
BEGIN
  IF v_pos IS NOT NULL AND v_emp IS NOT NULL AND v_shift IS NOT NULL THEN
    SELECT src.basic_salary
    INTO v_basic
    FROM public.salary_rate_config src
    WHERE src.tenant_id = p_tenant_id
      AND src.position = v_pos
      AND src.employment_type = v_emp
      AND src.shift = v_shift
      AND src.effective_date::date <= current_date
      AND (
        (p_business_unit_id IS NULL AND src.business_unit_id IS NULL)
        OR (
          p_business_unit_id IS NOT NULL
          AND (
            src.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            OR src.business_unit_id IS NULL
          )
        )
      )
    ORDER BY
      CASE
        WHEN p_business_unit_id IS NOT NULL AND src.business_unit_id IS NOT DISTINCT FROM p_business_unit_id THEN 0
        WHEN src.business_unit_id IS NULL THEN 1
        ELSE 2
      END,
      src.effective_date DESC
    LIMIT 1;

    v_basic := COALESCE(v_basic, 0);

    SELECT
      COALESCE(
        sum(
          CASE
            WHEN at.code = 'HOUSING' THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      ),
      COALESCE(
        sum(
          CASE
            WHEN at.code = 'TRANSPORT' THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      ),
      COALESCE(
        sum(
          CASE
            WHEN at.code NOT IN ('HOUSING', 'TRANSPORT') THEN round(cp.amount::numeric, 2)
            ELSE 0
          END
        ),
        0
      )
    INTO v_housing, v_transport, v_other
    FROM public.allowance_types at
    LEFT JOIN public.compensation_policy cp
      ON cp.tenant_id = at.tenant_id
      AND cp.allowance_type_id = at.id
      AND cp.position = v_pos
      AND cp.employment_type = v_emp
      AND cp.shift = v_shift
    WHERE at.tenant_id = p_tenant_id
      AND at.is_active = true;
  END IF;

  SELECT hps.default_welfare_deduction_rate
  INTO v_welfare
  FROM public.hr_payroll_settings hps
  WHERE hps.tenant_id = p_tenant_id
    AND hps.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT hps.default_welfare_deduction_rate
    INTO v_welfare
    FROM public.hr_payroll_settings hps
    WHERE hps.tenant_id = p_tenant_id
      AND hps.business_unit_id IS NULL
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT v_basic, v_housing, v_transport, v_other, v_welfare;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
