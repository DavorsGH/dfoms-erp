-- Script 131: Lessee (tenant) portal foundation
-- - Invite tokens for portal onboarding (hashed, expiring, single-use)
-- - current_user_lessee_id() helper (auth.uid() -> lessees.auth_user_id)
-- - Additive SELECT RLS so portal users can only read their own lease/unit/rent data
--
-- Staff Real Estate APIs use the service role (bypasses RLS). These policies are
-- the hard boundary for authenticated lessee JWT access.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Invite tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessee_portal_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lessee_id uuid NOT NULL,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessee_portal_invites_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_lessee
  ON public.lessee_portal_invites (tenant_id, lessee_id);

CREATE INDEX IF NOT EXISTS idx_lessee_portal_invites_expires
  ON public.lessee_portal_invites (expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE public.lessee_portal_invites IS
  'Single-use hashed invite tokens for Real Estate tenant (lessee) portal onboarding.';

ALTER TABLE public.lessee_portal_invites ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: invites are service-role only (admin APIs).
DROP POLICY IF EXISTS lessee_portal_invites_service_role_all ON public.lessee_portal_invites;
CREATE POLICY lessee_portal_invites_service_role_all
  ON public.lessee_portal_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.lessee_portal_invites TO service_role;
REVOKE ALL ON TABLE public.lessee_portal_invites FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Lessee identity helper (mirrors current_user_client_id / employee patterns)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_lessee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.lessee_id
  FROM public.lessees l
  WHERE l.auth_user_id = auth.uid()
  ORDER BY l.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_lessee_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_lessee_id() IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_lessee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_lessee_portal_user() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Portal SELECT policies (additive; do not replace staff/service access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.lessees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_portal_select_own_lessee ON public.lessees;
CREATE POLICY lessee_portal_select_own_lessee
  ON public.lessees
  FOR SELECT
  TO authenticated
  USING (lessee_id = public.current_user_lessee_id());

DROP POLICY IF EXISTS lessee_portal_select_own_leases ON public.leases;
CREATE POLICY lessee_portal_select_own_leases
  ON public.leases
  FOR SELECT
  TO authenticated
  USING (lessee_id = public.current_user_lessee_id());

DROP POLICY IF EXISTS lessee_portal_select_own_rent_ledger ON public.rent_ledger;
CREATE POLICY lessee_portal_select_own_rent_ledger
  ON public.rent_ledger
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases le
      WHERE le.tenant_id = rent_ledger.tenant_id
        AND le.lease_id = rent_ledger.lease_id
        AND le.lessee_id = public.current_user_lessee_id()
    )
  );

DROP POLICY IF EXISTS lessee_portal_select_own_units ON public.property_units;
CREATE POLICY lessee_portal_select_own_units
  ON public.property_units
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases le
      WHERE le.tenant_id = property_units.tenant_id
        AND le.unit_id = property_units.unit_id
        AND le.lessee_id = public.current_user_lessee_id()
        AND le.status = 'active'
    )
  );

DROP POLICY IF EXISTS lessee_portal_select_own_properties ON public.properties;
CREATE POLICY lessee_portal_select_own_properties
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases le
      JOIN public.property_units u
        ON u.tenant_id = le.tenant_id
       AND u.unit_id = le.unit_id
      WHERE u.property_id = properties.property_id
        AND le.tenant_id = properties.tenant_id
        AND le.lessee_id = public.current_user_lessee_id()
        AND le.status = 'active'
    )
  );

GRANT SELECT ON TABLE public.lessees TO authenticated;
GRANT SELECT ON TABLE public.leases TO authenticated;
GRANT SELECT ON TABLE public.rent_ledger TO authenticated;
GRANT SELECT ON TABLE public.property_units TO authenticated;
GRANT SELECT ON TABLE public.properties TO authenticated;

COMMIT;
