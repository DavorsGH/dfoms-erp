-- 248: RLS on facility_managers identity table (missed from 245) + activity persona.
-- Helpers in 243 are SECURITY DEFINER; middleware still needs a policy for
-- authenticated SELECT of the caller's own active row when metadata.portal is unset.
BEGIN;

ALTER TABLE public.facility_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facility_managers_tenant_select ON public.facility_managers;
CREATE POLICY facility_managers_tenant_select
  ON public.facility_managers
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_managers_tenant_insert ON public.facility_managers;
CREATE POLICY facility_managers_tenant_insert
  ON public.facility_managers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_managers_tenant_update ON public.facility_managers;
CREATE POLICY facility_managers_tenant_update
  ON public.facility_managers
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS facility_managers_tenant_delete ON public.facility_managers;
CREATE POLICY facility_managers_tenant_delete
  ON public.facility_managers
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS landlord_portal_manage_facility_managers ON public.facility_managers;
CREATE POLICY landlord_portal_manage_facility_managers
  ON public.facility_managers
  FOR ALL
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id())
  WITH CHECK (tenant_id = public.current_user_landlord_tenant_id());

DROP POLICY IF EXISTS facility_portal_select_own_facility_manager ON public.facility_managers;
CREATE POLICY facility_portal_select_own_facility_manager
  ON public.facility_managers
  FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    AND status = 'active'
  );

-- Activity log persona check (also in 247; idempotent here for single apply).
ALTER TABLE public.user_activity_log
  DROP CONSTRAINT IF EXISTS user_activity_log_persona_check;

ALTER TABLE public.user_activity_log
  ADD CONSTRAINT user_activity_log_persona_check
  CHECK (persona IN ('staff', 'lessee', 'landlord', 'facility_manager'));

COMMENT ON COLUMN public.user_activity_log.persona IS
  'Portal persona: staff ERP, lessee tenant portal, landlord portal, or facility manager portal.';

COMMIT;
