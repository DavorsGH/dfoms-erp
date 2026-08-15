-- Platform-only landlord annual billing cycle support.
-- Apply on staging before production.
--
-- Adds billing_cycle / pending_billing_cycle to landlord_subscriptions,
-- codifies the table DDL in-repo, extends audit trigger_type, and seeds
-- the per-unit annual platform rate.

-- ---------------------------------------------------------------------------
-- landlord_subscriptions (codified DDL — table existed in prod without migration)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.landlord_subscriptions (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  tier text,
  status text,
  trial_ends_at date,
  active_unit_count integer,
  current_period_price_ghs numeric(12, 2),
  included_units integer,
  extra_unit_price_ghs numeric(12, 2),
  current_period_start date,
  current_period_end date,
  base_price_ghs numeric(12, 2),
  billing_cycle text NOT NULL DEFAULT 'monthly',
  pending_billing_cycle text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Backfill columns on pre-existing deployments (must run before COMMENT ON COLUMN).
ALTER TABLE public.landlord_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly';

ALTER TABLE public.landlord_subscriptions
  ADD COLUMN IF NOT EXISTS pending_billing_cycle text;

ALTER TABLE public.landlord_subscriptions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.landlord_subscriptions
SET billing_cycle = 'monthly'
WHERE billing_cycle IS NULL;

COMMENT ON TABLE public.landlord_subscriptions IS
  'Platform-only landlord subscription state: trial, billing cycle, and paid period bounds. '
  'Managed by platform billing crons and landlord portal cycle switches.';

COMMENT ON COLUMN public.landlord_subscriptions.billing_cycle IS
  'Currently effective recurring cycle: monthly or annual.';

COMMENT ON COLUMN public.landlord_subscriptions.pending_billing_cycle IS
  'Deferred cycle switch. Only value used: monthly (annual→monthly at current_period_end).';

ALTER TABLE public.landlord_subscriptions
  DROP CONSTRAINT IF EXISTS landlord_subscriptions_billing_cycle_check;

ALTER TABLE public.landlord_subscriptions
  ADD CONSTRAINT landlord_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'annual'));

ALTER TABLE public.landlord_subscriptions
  DROP CONSTRAINT IF EXISTS landlord_subscriptions_pending_billing_cycle_check;

ALTER TABLE public.landlord_subscriptions
  ADD CONSTRAINT landlord_subscriptions_pending_billing_cycle_check
  CHECK (pending_billing_cycle IS NULL OR pending_billing_cycle = 'monthly');

CREATE INDEX IF NOT EXISTS idx_landlord_subscriptions_billing_cycle
  ON public.landlord_subscriptions (billing_cycle, status);

-- ---------------------------------------------------------------------------
-- landlord_unit_activation_charges — extend trigger_type for annual renewals
-- ---------------------------------------------------------------------------

ALTER TABLE public.landlord_unit_activation_charges
  DROP CONSTRAINT IF EXISTS landlord_unit_activation_charges_trigger_type_check;

ALTER TABLE public.landlord_unit_activation_charges
  ADD CONSTRAINT landlord_unit_activation_charges_trigger_type_check
  CHECK (trigger_type IN (
    'activation',
    'reactivation',
    'create',
    'monthly_recurring',
    'annual_recurring'
  ));

COMMENT ON TABLE public.landlord_unit_activation_charges IS
  'Immutable audit trail for platform_only per-unit activation charges and '
  'recurring combined unit billing (monthly_recurring / annual_recurring). '
  'Application inserts only.';

-- ---------------------------------------------------------------------------
-- platform_billing_config — per-unit annual rate (David sets via admin UI)
-- ---------------------------------------------------------------------------

INSERT INTO public.platform_billing_config (config_key, price_ghs)
VALUES ('platform_only_unit_annual', 1100.00)
ON CONFLICT (config_key) DO NOTHING;
