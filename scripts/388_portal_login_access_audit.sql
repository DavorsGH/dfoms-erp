BEGIN;

CREATE TABLE IF NOT EXISTS public.portal_login_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_auth_uid uuid NOT NULL,
  actor_persona text NOT NULL
    CHECK (actor_persona IN ('davors_admin', 'landlord')),
  actor_tenant_id uuid NULL,
  target_persona text NOT NULL
    CHECK (target_persona IN ('landlord', 'lessee', 'facility_manager')),
  target_record_id uuid NOT NULL,
  target_auth_uid uuid NULL,
  action text NOT NULL
    CHECK (action IN ('reset_link_sent', 'temp_password_set', 'email_changed', 'login_created')),
  old_email text NULL,
  new_email text NULL,
  verification_method text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_login_access_audit_created_at_desc_idx
  ON public.portal_login_access_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS portal_login_access_audit_target_idx
  ON public.portal_login_access_audit (target_persona, target_record_id, created_at DESC);

ALTER TABLE public.portal_login_access_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_login_access_audit_davors_platform_select
  ON public.portal_login_access_audit;
CREATE POLICY portal_login_access_audit_davors_platform_select
  ON public.portal_login_access_audit
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  );

REVOKE ALL ON TABLE public.portal_login_access_audit FROM PUBLIC;
REVOKE ALL ON TABLE public.portal_login_access_audit FROM anon;
GRANT SELECT ON TABLE public.portal_login_access_audit TO authenticated;
GRANT ALL ON TABLE public.portal_login_access_audit TO service_role;

COMMIT;
