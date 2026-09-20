-- Script 290: Scope hr_payroll_settings by business_unit_id (one default row per BU).
-- Prerequisite: script 289 (hr_payroll_settings table).
-- Existing tenant-only rows become null-BU workspace defaults (NULLS NOT DISTINCT).

BEGIN;

ALTER TABLE public.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS business_unit_id uuid
  REFERENCES public.business_units (id) ON DELETE CASCADE;

COMMENT ON COLUMN public.hr_payroll_settings.business_unit_id IS
  'Business unit for this welfare default; NULL = workspace/legacy default (tenants with no BUs).';

ALTER TABLE public.hr_payroll_settings
  DROP CONSTRAINT IF EXISTS hr_payroll_settings_pkey;

ALTER TABLE public.hr_payroll_settings
  DROP CONSTRAINT IF EXISTS hr_payroll_settings_tenant_bu_unique;

ALTER TABLE public.hr_payroll_settings
  ADD CONSTRAINT hr_payroll_settings_tenant_bu_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id);

CREATE INDEX IF NOT EXISTS idx_hr_payroll_settings_tenant_bu
  ON public.hr_payroll_settings (tenant_id, business_unit_id);

COMMENT ON TABLE public.hr_payroll_settings IS
  'Per business-unit HR payroll defaults (Salary Settings). NULL business_unit_id = workspace default.';

-- RLS: business-unit access (Tier A/B/C/D pattern; requires user_has_business_unit_access() from BU Phase 2+).
ALTER POLICY hr_payroll_settings_tenant_select ON public.hr_payroll_settings
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

ALTER POLICY hr_payroll_settings_tenant_insert ON public.hr_payroll_settings
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

ALTER POLICY hr_payroll_settings_tenant_update ON public.hr_payroll_settings
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

ALTER POLICY hr_payroll_settings_tenant_delete ON public.hr_payroll_settings
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

ALTER POLICY hr_payroll_settings_super_admin_full_access ON public.hr_payroll_settings
  USING (
    public.is_super_admin()
    AND public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    public.is_super_admin()
    AND public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

COMMIT;
