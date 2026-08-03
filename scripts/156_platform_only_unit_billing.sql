-- Platform-only landlord per-unit metered billing foundation.
-- Apply on staging/production before using unit activation charges.
--
-- Scope: billing activation state on property_units, stored Paystack authorization
-- on landlords, immutable activation-charge audit log.
-- Recurring monthly cron is NOT included (follow-up batch).

-- ---------------------------------------------------------------------------
-- property_units: billing activation (separate from operational status)
-- ---------------------------------------------------------------------------
ALTER TABLE public.property_units
  ADD COLUMN IF NOT EXISTS billing_activation_status text NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS billing_activated_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_units_billing_activation_status_check'
  ) THEN
    ALTER TABLE public.property_units
      ADD CONSTRAINT property_units_billing_activation_status_check
      CHECK (billing_activation_status IN ('inactive', 'active'));
  END IF;
END $$;

COMMENT ON COLUMN public.property_units.billing_activation_status IS
  'Platform-only metered billing: active units count toward per-unit charges. '
  'Separate from operational status (vacant/occupied/under_maintenance/application_hold).';

COMMENT ON COLUMN public.property_units.billing_activated_at IS
  'When billing_activation_status was last set to active (UTC). NULL when inactive.';

-- ---------------------------------------------------------------------------
-- landlords: Paystack authorization for off-session activation charges
-- ---------------------------------------------------------------------------
ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS paystack_charge_authorization_code text NULL,
  ADD COLUMN IF NOT EXISTS paystack_charge_authorization_email text NULL,
  ADD COLUMN IF NOT EXISTS paystack_charge_authorization_channel text NULL;

COMMENT ON COLUMN public.landlords.paystack_charge_authorization_code IS
  'Paystack reusable authorization_code for platform_only unit activation charges (charge_authorization API).';

-- ---------------------------------------------------------------------------
-- Immutable audit log (insert-only in application code)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.landlord_unit_activation_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  amount_ghs numeric(12, 2) NOT NULL,
  charge_status text NOT NULL
    CHECK (charge_status IN ('success', 'failed', 'skipped_trial', 'pending')),
  paystack_reference text NULL,
  failure_reason text NULL,
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('activation', 'reactivation', 'create')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS landlord_unit_activation_charges_tenant_idx
  ON public.landlord_unit_activation_charges (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS landlord_unit_activation_charges_unit_idx
  ON public.landlord_unit_activation_charges (unit_id, created_at DESC);

COMMENT ON TABLE public.landlord_unit_activation_charges IS
  'Immutable audit trail for platform_only per-unit activation charges (GHS 110). Application inserts only.';

ALTER TABLE public.landlord_unit_activation_charges ENABLE ROW LEVEL SECURITY;
