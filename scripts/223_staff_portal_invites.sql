-- Script 223: Staff ERP portal invite tokens (hashed, expiring, single-use)
-- Mirrors lessee_portal_invites / landlord_portal_invites patterns.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Invite tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_portal_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  email text NOT NULL,
  token_hash text NOT NULL,
  role public.app_role NOT NULL,
  employee_id text NULL,
  client_id text NULL,
  invited_by uuid NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_portal_invites_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_staff_portal_invites_tenant_email
  ON public.staff_portal_invites (tenant_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_staff_portal_invites_expires
  ON public.staff_portal_invites (expires_at)
  WHERE used_at IS NULL;

COMMENT ON TABLE public.staff_portal_invites IS
  'Single-use hashed invite tokens for staff ERP onboarding into an existing tenant.';

ALTER TABLE public.staff_portal_invites ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: invites are service-role only (admin APIs).
DROP POLICY IF EXISTS staff_portal_invites_service_role_all ON public.staff_portal_invites;
CREATE POLICY staff_portal_invites_service_role_all
  ON public.staff_portal_invites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.staff_portal_invites TO service_role;
REVOKE ALL ON TABLE public.staff_portal_invites FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. Pending supervisor sites (applied on invite accept)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_portal_invite_supervisor_sites (
  invite_id uuid NOT NULL REFERENCES public.staff_portal_invites (invite_id) ON DELETE CASCADE,
  site_code text NOT NULL,
  PRIMARY KEY (invite_id, site_code)
);

COMMENT ON TABLE public.staff_portal_invite_supervisor_sites IS
  'Supervisor site codes to sync when a staff_portal_invites row is accepted.';

ALTER TABLE public.staff_portal_invite_supervisor_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_portal_invite_supervisor_sites_service_role_all
  ON public.staff_portal_invite_supervisor_sites;
CREATE POLICY staff_portal_invite_supervisor_sites_service_role_all
  ON public.staff_portal_invite_supervisor_sites
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.staff_portal_invite_supervisor_sites TO service_role;
REVOKE ALL ON TABLE public.staff_portal_invite_supervisor_sites FROM authenticated, anon;

COMMIT;
