BEGIN;

CREATE TABLE IF NOT EXISTS public.statutory_paye_tax_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'GH',
  effective_date date NOT NULL,
  band_order integer NOT NULL,
  lower_bound numeric(12, 2) NOT NULL,
  upper_bound numeric(12, 2),
  rate numeric(5, 4) NOT NULL,
  CONSTRAINT statutory_paye_tax_bands_country_effective_band_key
    UNIQUE (country_code, effective_date, band_order)
);

CREATE TABLE IF NOT EXISTS public.statutory_ssnit_rate_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'GH',
  effective_date date NOT NULL,
  employee_rate numeric(5, 4) NOT NULL,
  employer_tier1_rate numeric(5, 4) NOT NULL,
  employer_tier2_rate numeric(5, 4) NOT NULL,
  insurable_earnings_ceiling numeric(12, 2),
  notes text,
  CONSTRAINT statutory_ssnit_rate_config_country_effective_key
    UNIQUE (country_code, effective_date)
);

CREATE TABLE IF NOT EXISTS public.statutory_casual_tax_rate_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'GH',
  effective_date date NOT NULL,
  flat_rate numeric(5, 4) NOT NULL,
  notes text,
  CONSTRAINT statutory_casual_tax_rate_config_country_effective_key
    UNIQUE (country_code, effective_date)
);

ALTER TABLE public.statutory_paye_tax_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statutory_ssnit_rate_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statutory_casual_tax_rate_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_paye_tax_bands_authenticated_select ON public.statutory_paye_tax_bands;
CREATE POLICY statutory_paye_tax_bands_authenticated_select
  ON public.statutory_paye_tax_bands
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS statutory_ssnit_rate_config_authenticated_select ON public.statutory_ssnit_rate_config;
CREATE POLICY statutory_ssnit_rate_config_authenticated_select
  ON public.statutory_ssnit_rate_config
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS statutory_casual_tax_rate_config_authenticated_select ON public.statutory_casual_tax_rate_config;
CREATE POLICY statutory_casual_tax_rate_config_authenticated_select
  ON public.statutory_casual_tax_rate_config
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.statutory_paye_tax_bands TO authenticated;
GRANT SELECT ON public.statutory_ssnit_rate_config TO authenticated;
GRANT SELECT ON public.statutory_casual_tax_rate_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_paye_tax_bands TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_ssnit_rate_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_casual_tax_rate_config TO service_role;

INSERT INTO public.statutory_paye_tax_bands (
  country_code,
  effective_date,
  band_order,
  lower_bound,
  upper_bound,
  rate
)
SELECT
  'GH',
  effective_date,
  band_order,
  lower_bound,
  upper_bound,
  rate
FROM public.paye_tax_bands
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
ON CONFLICT (country_code, effective_date, band_order) DO NOTHING;

INSERT INTO public.statutory_ssnit_rate_config (
  country_code,
  effective_date,
  employee_rate,
  employer_tier1_rate,
  employer_tier2_rate,
  insurable_earnings_ceiling,
  notes
)
SELECT
  'GH',
  effective_date,
  employee_rate,
  employer_tier1_rate,
  employer_tier2_rate,
  insurable_earnings_ceiling,
  notes
FROM public.ssnit_rate_config
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
ON CONFLICT (country_code, effective_date) DO NOTHING;

INSERT INTO public.statutory_casual_tax_rate_config (
  country_code,
  effective_date,
  flat_rate,
  notes
)
SELECT
  'GH',
  effective_date,
  flat_rate,
  notes
FROM public.casual_tax_rate_config
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
ON CONFLICT (country_code, effective_date) DO NOTHING;

COMMIT;

SELECT COUNT(*) AS statutory_paye_rows FROM public.statutory_paye_tax_bands WHERE country_code = 'GH';
SELECT COUNT(*) AS statutory_ssnit_rows FROM public.statutory_ssnit_rate_config WHERE country_code = 'GH';
SELECT COUNT(*) AS statutory_casual_rows FROM public.statutory_casual_tax_rate_config WHERE country_code = 'GH';
SELECT effective_date, COUNT(*) AS band_count
FROM public.statutory_paye_tax_bands
WHERE country_code = 'GH'
GROUP BY effective_date
ORDER BY effective_date;
