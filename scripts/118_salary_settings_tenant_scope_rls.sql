-- Script 118: Close cross-tenant leak on Global Salary Settings tables.
-- Definition: apply to staging first. Do NOT apply to production until approved.
--
-- Root cause: script 117 created *_super_admin_full_access policies with
--   USING (is_super_admin()) / WITH CHECK (is_super_admin())
-- and NO tenant_matches(tenant_id). Permissive RLS ORs policies, so a Davors
-- (or Caanta) super_admin SELECT sees BOTH tenants' allowance_types /
-- compensation_policy / payroll_allowance_lines rows — which presents as
-- "duplicate" HOUSING/TRANSPORT/OTHER/NIGHT_DIFF rows (exactly 2 of each when
-- there are 2 tenants).
--
-- Fix: match script 69 / script 60 pattern —
--   USING (tenant_matches(tenant_id) AND is_super_admin())
-- Data itself is correct (4 rows per tenant from the 117 seed). Do NOT delete.

BEGIN;

DROP POLICY IF EXISTS allowance_types_super_admin_full_access
  ON public.allowance_types;
CREATE POLICY allowance_types_super_admin_full_access
  ON public.allowance_types
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS compensation_policy_super_admin_full_access
  ON public.compensation_policy;
CREATE POLICY compensation_policy_super_admin_full_access
  ON public.compensation_policy
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS payroll_allowance_lines_super_admin_full_access
  ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_super_admin_full_access
  ON public.payroll_allowance_lines
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;
