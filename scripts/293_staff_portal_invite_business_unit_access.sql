-- Script 293: Pending business unit access on staff portal invites (applied on accept).
-- Mirrors staff_portal_invite_supervisor_sites (script 223).

BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_portal_invite_business_unit_access (
  invite_id uuid NOT NULL REFERENCES public.staff_portal_invites (invite_id) ON DELETE CASCADE,
  business_unit_id uuid NOT NULL REFERENCES public.business_units (id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  PRIMARY KEY (invite_id, business_unit_id)
);

COMMENT ON TABLE public.staff_portal_invite_business_unit_access IS
  'Business unit access rows to sync when a staff_portal_invites row is accepted.';

ALTER TABLE public.staff_portal_invite_business_unit_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_portal_invite_business_unit_access_service_role_all
  ON public.staff_portal_invite_business_unit_access;
CREATE POLICY staff_portal_invite_business_unit_access_service_role_all
  ON public.staff_portal_invite_business_unit_access
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.staff_portal_invite_business_unit_access TO service_role;
REVOKE ALL ON TABLE public.staff_portal_invite_business_unit_access FROM authenticated, anon;

COMMIT;
