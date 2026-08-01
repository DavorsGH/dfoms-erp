-- Script 139: Landlord portal foundation
-- - landlords.auth_user_id (mirror lessees.auth_user_id)
-- - Invite tokens for landlord portal onboarding (hashed, expiring, single-use)
-- - current_user_landlord_tenant_id() helper (auth.uid() -> landlords.auth_user_id)
-- - Additive SELECT RLS so portal landlords can only read their own tenant_id data
--
-- Staff Real Estate APIs use the service role (bypasses RLS). These policies are
-- the hard boundary for authenticated landlord JWT access.
--
-- SCHEMA FLAGS (verify in staging before apply if needed):
-- - Contact email for invites is tenants.email (not a landlords column).
-- - landlords PK is tenant_id (no separate landlord_id).
-- - escrow_ledger / landlord_payouts / maintenance_requests table DDL is pre-existing.
-- - Does not weaken existing staff/tenant_matches policies (additive only).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Link landlords to Supabase Auth users
-- ---------------------------------------------------------------------------
ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_landlords_auth_user_id
  ON public.landlords (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.landlords.auth_user_id IS
  'Supabase Auth user id for Landlord Portal login (null until invite accepted).';

-- ---------------------------------------------------------------------------
-- 2. Invite tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.landlord_portal_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT landlord_portal_invites_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_landlord_portal_invites_tenant
  ON public.landlord_portal_invites (tenant_id);

CREATE INDEX IF NOT EXISTS idx_landlord_portal_invites_expires
  ON public.landlord_portal_invites (expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE public.landlord_portal_invites IS
  'Single-use hashed invite tokens for Real Estate Landlord Portal onboarding. '
  'Email is copied from tenants.email at invite time.';

ALTER TABLE public.landlord_portal_invites ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: invites are service-role only (admin APIs).
DROP POLICY IF EXISTS landlord_portal_invites_service_role_all ON public.landlord_portal_invites;
CREATE POLICY landlord_portal_invites_service_role_all
  ON public.landlord_portal_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.landlord_portal_invites TO service_role;
REVOKE ALL ON TABLE public.landlord_portal_invites FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. Landlord identity helpers
--    auth.uid() -> landlords.auth_user_id -> landlords.tenant_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_landlord_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.tenant_id
  FROM public.landlords l
  WHERE l.auth_user_id = auth.uid()
    AND l.approval_status = 'approved'
  ORDER BY l.created_at ASC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_landlord_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_landlord_tenant_id() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_landlord_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_landlord_portal_user() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Portal SELECT policies (additive; do not replace staff/service access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.landlords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessee_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landlord_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landlord_portal_select_own_landlord ON public.landlords;
CREATE POLICY landlord_portal_select_own_landlord
  ON public.landlords
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_tenant ON public.tenants;
CREATE POLICY landlord_portal_select_own_tenant
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_properties ON public.properties;
CREATE POLICY landlord_portal_select_own_properties
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_units ON public.property_units;
CREATE POLICY landlord_portal_select_own_units
  ON public.property_units
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_lessees ON public.lessees;
CREATE POLICY landlord_portal_select_own_lessees
  ON public.lessees
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_leases ON public.leases;
CREATE POLICY landlord_portal_select_own_leases
  ON public.leases
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_rent_ledger ON public.rent_ledger;
CREATE POLICY landlord_portal_select_own_rent_ledger
  ON public.rent_ledger
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_maintenance ON public.maintenance_requests;
CREATE POLICY landlord_portal_select_own_maintenance
  ON public.maintenance_requests
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_complaints ON public.lessee_complaints;
CREATE POLICY landlord_portal_select_own_complaints
  ON public.lessee_complaints
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_escrow ON public.escrow_ledger;
CREATE POLICY landlord_portal_select_own_escrow
  ON public.escrow_ledger
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS landlord_portal_select_own_payouts ON public.landlord_payouts;
CREATE POLICY landlord_portal_select_own_payouts
  ON public.landlord_payouts
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

GRANT SELECT ON TABLE public.landlords TO authenticated;
GRANT SELECT ON TABLE public.tenants TO authenticated;
GRANT SELECT ON TABLE public.properties TO authenticated;
GRANT SELECT ON TABLE public.property_units TO authenticated;
GRANT SELECT ON TABLE public.lessees TO authenticated;
GRANT SELECT ON TABLE public.leases TO authenticated;
GRANT SELECT ON TABLE public.rent_ledger TO authenticated;
GRANT SELECT ON TABLE public.maintenance_requests TO authenticated;
GRANT SELECT ON TABLE public.lessee_complaints TO authenticated;
GRANT SELECT ON TABLE public.escrow_ledger TO authenticated;
GRANT SELECT ON TABLE public.landlord_payouts TO authenticated;

COMMIT;
