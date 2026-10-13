-- Platform billing income / Paystack fee rows post to a configurable Davors business unit.
-- Apply on staging/production before deploying app code that reads business_unit_id here.

BEGIN;

ALTER TABLE public.platform_billing_config
  ADD COLUMN IF NOT EXISTS business_unit_id uuid NULL
    REFERENCES public.business_units (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.platform_billing_config.business_unit_id IS
  'For config_key platform_billing_business_unit: Davors business unit that receives '
  'platform billing income_register and related Paystack fee expense_register postings. '
  'Unused (NULL) for price/cap config keys.';

INSERT INTO public.platform_billing_config (config_key, price_ghs, business_unit_id)
VALUES (
  'platform_billing_business_unit',
  0,
  '0e8ff902-f00c-4bf0-bba1-eb2a612b895b'::uuid
)
ON CONFLICT (config_key) DO UPDATE
SET business_unit_id = COALESCE(
  public.platform_billing_config.business_unit_id,
  EXCLUDED.business_unit_id
);

COMMIT;
