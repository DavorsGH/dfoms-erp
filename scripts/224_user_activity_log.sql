-- Script 224: User activity log — Phase 1 login events only.
-- Apply on staging first; production after verification.
--
-- Inserts via service_role only. SELECT:
--   - Davors platform super_admin: all rows (all tenants)
--   - Tenant staff super_admin/director: own tenant_id only
--   - Landlord portal (approved): own tenant_id only

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona text NOT NULL
    CHECK (persona IN ('staff', 'lessee', 'landlord')),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  auth_user_id uuid NULL,
  email text NULL,
  event_name text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('success', 'failure')),
  ip text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_activity_log IS
  'Login activity audit (Phase 1). Written by service_role; readable by Davors platform '
  'super_admin (all tenants) or tenant/landlord admins scoped to tenant_id.';

COMMENT ON COLUMN public.user_activity_log.persona IS
  'Portal persona: staff ERP, lessee tenant portal, or landlord portal.';

COMMENT ON COLUMN public.user_activity_log.tenant_id IS
  'Workspace tenant when known; NULL for pre-auth failures (e.g. bad password).';

CREATE INDEX IF NOT EXISTS user_activity_log_created_at_desc_idx
  ON public.user_activity_log (created_at DESC);

CREATE INDEX IF NOT EXISTS user_activity_log_tenant_created_at_desc_idx
  ON public.user_activity_log (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_activity_log_persona_created_at_desc_idx
  ON public.user_activity_log (persona, created_at DESC);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

-- Davors platform operator: cross-tenant read (mirror system_event_log).
DROP POLICY IF EXISTS user_activity_log_davors_platform_select ON public.user_activity_log;
CREATE POLICY user_activity_log_davors_platform_select
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  );

-- Tenant ERP admins: own tenant only; super_admin or director (not all staff roles).
DROP POLICY IF EXISTS user_activity_log_tenant_admin_select ON public.user_activity_log;
CREATE POLICY user_activity_log_tenant_admin_select
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_user_tenant_id()
    AND current_user_role() IN ('super_admin'::app_role, 'director'::app_role)
  );

-- Landlord portal: approved landlord sees logins for their org tenant_id.
DROP POLICY IF EXISTS user_activity_log_landlord_select ON public.user_activity_log;
CREATE POLICY user_activity_log_landlord_select
  ON public.user_activity_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_user_landlord_tenant_id()
  );

REVOKE ALL ON TABLE public.user_activity_log FROM PUBLIC;
REVOKE ALL ON TABLE public.user_activity_log FROM anon;
GRANT SELECT ON TABLE public.user_activity_log TO authenticated;
GRANT ALL ON TABLE public.user_activity_log TO service_role;

COMMIT;
