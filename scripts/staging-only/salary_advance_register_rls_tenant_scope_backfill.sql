-- STAGING ONLY: DBs that already applied pre-fix scripts/372_salary_advance_register.sql
-- (super_admin_full_access without tenant_matches). Production must run corrected 372 only.
BEGIN;

DROP POLICY IF EXISTS super_admin_full_access ON public.salary_advance_register;
CREATE POLICY super_admin_full_access
  ON public.salary_advance_register
  USING (public.is_super_admin() AND public.tenant_matches(tenant_id))
  WITH CHECK (public.is_super_admin() AND public.tenant_matches(tenant_id));

COMMIT;
