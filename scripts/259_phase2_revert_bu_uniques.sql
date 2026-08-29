-- Revert Phase 2 BU-scoped uniques on remaining multi-BU tables to match
-- currently-deployed app onConflict/upsert targets (no business_unit_id).
-- business_unit_id columns are kept for Phase 5e (schema + app together).
--
-- tax_settings app: onConflict "tenant_id"
-- payroll_link: no live app upsert today; restore tenant_id+payroll_month
-- manual_financial_entries app: insert/update (scripts use tenant_id,period_month)

-- 1) tax_settings: keep one row per tenant (NULLS in BU unique allowed dupes)
DELETE FROM public.tax_settings a
USING public.tax_settings b
WHERE a.tenant_id = b.tenant_id
  AND a.id < b.id;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_bu_unique;
DROP INDEX IF EXISTS public.tax_settings_tenant_bu_unique;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_id_unique;
ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_id_key;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tenant_id_unique UNIQUE (tenant_id);

-- 2) payroll_link
ALTER TABLE public.payroll_link
  DROP CONSTRAINT IF EXISTS payroll_link_tenant_bu_month_unique;
DROP INDEX IF EXISTS public.payroll_link_tenant_bu_month_unique;

ALTER TABLE public.payroll_link
  DROP CONSTRAINT IF EXISTS payroll_link_tenant_month_unique;

ALTER TABLE public.payroll_link
  ADD CONSTRAINT payroll_link_tenant_month_unique
  UNIQUE (tenant_id, payroll_month);

-- 3) manual_financial_entries
ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_tenant_bu_period_unique;
DROP INDEX IF EXISTS public.manual_financial_entries_tenant_bu_period_unique;

ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_tenant_period_unique;
ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_period_month_key;

ALTER TABLE public.manual_financial_entries
  ADD CONSTRAINT manual_financial_entries_tenant_period_unique
  UNIQUE (tenant_id, period_month);
