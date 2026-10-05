BEGIN;

CREATE TABLE IF NOT EXISTS public.statutory_overtime_tax_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'GH',
  effective_date date NOT NULL,
  junior_annual_income_threshold numeric(12, 2) NOT NULL,
  basic_salary_split_ratio numeric(5, 4) NOT NULL,
  rate_within_split numeric(5, 4) NOT NULL,
  rate_above_split numeric(5, 4) NOT NULL,
  notes text,
  CONSTRAINT statutory_overtime_tax_config_country_effective_key
    UNIQUE (country_code, effective_date)
);

ALTER TABLE public.statutory_overtime_tax_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_overtime_tax_config_authenticated_select ON public.statutory_overtime_tax_config;
CREATE POLICY statutory_overtime_tax_config_authenticated_select
  ON public.statutory_overtime_tax_config
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.statutory_overtime_tax_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_overtime_tax_config TO service_role;

INSERT INTO public.statutory_overtime_tax_config (
  country_code,
  effective_date,
  junior_annual_income_threshold,
  basic_salary_split_ratio,
  rate_within_split,
  rate_above_split,
  notes
)
VALUES (
  'GH',
  '2026-10-01',
  18000,
  0.5,
  0.05,
  0.10,
  'GRA junior overtime final tax (Oct 2026+)'
)
ON CONFLICT (country_code, effective_date) DO NOTHING;

ALTER TABLE public.payroll_processing
  ADD COLUMN IF NOT EXISTS overtime_tax numeric(12, 2) DEFAULT 0;

ALTER TABLE public.payroll_history
  ADD COLUMN IF NOT EXISTS overtime_tax numeric(12, 2) DEFAULT 0;

COMMIT;
