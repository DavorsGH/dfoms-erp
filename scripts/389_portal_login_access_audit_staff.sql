BEGIN;

ALTER TABLE public.portal_login_access_audit
  DROP CONSTRAINT IF EXISTS portal_login_access_audit_actor_persona_check;

ALTER TABLE public.portal_login_access_audit
  ADD CONSTRAINT portal_login_access_audit_actor_persona_check
  CHECK (actor_persona IN ('davors_admin', 'landlord', 'tenant_admin'));

ALTER TABLE public.portal_login_access_audit
  DROP CONSTRAINT IF EXISTS portal_login_access_audit_target_persona_check;

ALTER TABLE public.portal_login_access_audit
  ADD CONSTRAINT portal_login_access_audit_target_persona_check
  CHECK (target_persona IN ('landlord', 'lessee', 'facility_manager', 'staff'));

COMMIT;
