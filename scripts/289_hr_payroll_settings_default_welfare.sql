-- Script 289: Tenant default welfare deduction rate for new employees (HR Settings).
-- Forward-only: pre-fills employees.welfare_deduction_rate on create; does not backfill.

BEGIN;

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS welfare_deduction_rate numeric(5, 2);

COMMENT ON COLUMN public.employees.welfare_deduction_rate IS
  'Percent of period gross pay (e.g. 2.50 = 2.5%). Auto-applied in payroll; overridable per employee.';

CREATE TABLE IF NOT EXISTS public.hr_payroll_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  default_welfare_deduction_rate numeric(5, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hr_payroll_settings_default_welfare_nonneg
    CHECK (
      default_welfare_deduction_rate IS NULL
      OR default_welfare_deduction_rate >= 0
    )
);

COMMENT ON TABLE public.hr_payroll_settings IS
  'Tenant-wide HR payroll defaults (Salary Settings). Applied when creating new employees only.';

COMMENT ON COLUMN public.hr_payroll_settings.default_welfare_deduction_rate IS
  'Default percent for new employees (e.g. 2.50 = 2.5%). Stored on employee at hire; editable per employee.';

DROP TRIGGER IF EXISTS trg_hr_payroll_settings_enforce_tenant_id
  ON public.hr_payroll_settings;
CREATE TRIGGER trg_hr_payroll_settings_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.hr_payroll_settings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.hr_payroll_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hr_payroll_settings_tenant_select ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_tenant_select
  ON public.hr_payroll_settings
  FOR SELECT TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS hr_payroll_settings_tenant_insert ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_tenant_insert
  ON public.hr_payroll_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS hr_payroll_settings_tenant_update ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_tenant_update
  ON public.hr_payroll_settings
  FOR UPDATE TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS hr_payroll_settings_tenant_delete ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_tenant_delete
  ON public.hr_payroll_settings
  FOR DELETE TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS hr_payroll_settings_super_admin_full_access
  ON public.hr_payroll_settings;
CREATE POLICY hr_payroll_settings_super_admin_full_access
  ON public.hr_payroll_settings
  FOR ALL TO authenticated
  USING (public.is_super_admin() AND public.tenant_matches(tenant_id))
  WITH CHECK (public.is_super_admin() AND public.tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_settings TO service_role;

COMMIT;
