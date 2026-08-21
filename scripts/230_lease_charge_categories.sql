-- =============================================================================
-- 230_lease_charge_categories.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Tenant charge categories for utilities and service costs on rent_ledger:
--   - charge_category on rent_ledger (nullable; null = rent / legacy one-time)
--   - lease_charge_settings per lease per category (defaults off)
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- rent_ledger.charge_category
-- ---------------------------------------------------------------------------
ALTER TABLE public.rent_ledger
  ADD COLUMN IF NOT EXISTS charge_category text;

ALTER TABLE public.rent_ledger
  DROP CONSTRAINT IF EXISTS rent_ledger_charge_category_check;

ALTER TABLE public.rent_ledger
  ADD CONSTRAINT rent_ledger_charge_category_check
  CHECK (
    charge_category IS NULL
    OR charge_category IN (
      'water',
      'electricity',
      'refuse',
      'sewage',
      'security',
      'gardening',
      'service_charge'
    )
  );

CREATE INDEX IF NOT EXISTS idx_rent_ledger_lease_charge_category
  ON public.rent_ledger (tenant_id, lease_id, charge_category, period_start)
  WHERE charge_category IS NOT NULL;

COMMENT ON COLUMN public.rent_ledger.charge_category IS
  'Optional utility/service bucket for one_time rows. Null for rent and legacy one-time charges.';

-- ---------------------------------------------------------------------------
-- lease_charge_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lease_charge_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  charge_category text NOT NULL,
  is_billed boolean NOT NULL DEFAULT false,
  billing_mode text NOT NULL DEFAULT 'recurring',
  flat_amount_ghs numeric(12, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lease_charge_settings_category_check
    CHECK (
      charge_category IN (
        'water',
        'electricity',
        'refuse',
        'sewage',
        'security',
        'gardening',
        'service_charge'
      )
    ),
  CONSTRAINT lease_charge_settings_billing_mode_check
    CHECK (billing_mode IN ('recurring', 'one_off')),
  CONSTRAINT lease_charge_settings_lease_category_unique
    UNIQUE (lease_id, charge_category),
  CONSTRAINT lease_charge_settings_recurring_amount_check
    CHECK (
      NOT is_billed
      OR billing_mode <> 'recurring'
      OR (flat_amount_ghs IS NOT NULL AND flat_amount_ghs > 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_lease_charge_settings_lease
  ON public.lease_charge_settings (tenant_id, lease_id);

CREATE INDEX IF NOT EXISTS idx_lease_charge_settings_recurring_billed
  ON public.lease_charge_settings (lease_id, charge_category)
  WHERE is_billed = true AND billing_mode = 'recurring';

COMMENT ON TABLE public.lease_charge_settings IS
  'Per-lease utility/service charge configuration. All categories default off until enabled.';

-- ---------------------------------------------------------------------------
-- RLS: staff (tenant_matches via leases) + landlord portal SELECT
-- Mutations go through service-role APIs (same as rent_ledger writes).
-- ---------------------------------------------------------------------------
ALTER TABLE public.lease_charge_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lease_charge_settings_tenant_select ON public.lease_charge_settings;
CREATE POLICY lease_charge_settings_tenant_select
  ON public.lease_charge_settings
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lease_charge_settings_tenant_insert ON public.lease_charge_settings;
CREATE POLICY lease_charge_settings_tenant_insert
  ON public.lease_charge_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lease_charge_settings_tenant_update ON public.lease_charge_settings;
CREATE POLICY lease_charge_settings_tenant_update
  ON public.lease_charge_settings
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lease_charge_settings_tenant_delete ON public.lease_charge_settings;
CREATE POLICY lease_charge_settings_tenant_delete
  ON public.lease_charge_settings
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_select_own_lease_charge_settings ON public.lease_charge_settings;
CREATE POLICY landlord_portal_select_own_lease_charge_settings
  ON public.lease_charge_settings
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

GRANT SELECT ON TABLE public.lease_charge_settings TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
