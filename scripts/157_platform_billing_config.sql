-- Platform-wide billing configuration (editable without code deploy).
-- Pattern: singleton rows keyed by config_key (similar intent to sms_credit_packs).

CREATE TABLE IF NOT EXISTS public.platform_billing_config (
  config_key text PRIMARY KEY,
  price_ghs numeric(12, 2) NOT NULL CHECK (price_ghs >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_billing_config IS
  'Platform-wide billing rates editable by Davors platform super_admin. '
  'Charge-time code reads from here; historical charges stay in audit tables.';

INSERT INTO public.platform_billing_config (config_key, price_ghs)
VALUES ('platform_only_unit_activation', 110.00)
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.platform_billing_config ENABLE ROW LEVEL SECURITY;
