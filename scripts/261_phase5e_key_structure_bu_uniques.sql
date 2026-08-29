-- Phase 5e: put business_unit_id into unique keys for the four "key-structure" tables.
-- Must ship with matching app onConflict targets (see guard-261-deployed-onconflict.ts).
-- NULL business_unit_id remains the default/legacy row (NULLS NOT DISTINCT).
-- Do NOT add columns — they already exist from Phase 2.

-- 1) tax_settings: (tenant_id) → (tenant_id, business_unit_id)
ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_id_unique;
ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_id_key;
ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tenant_bu_unique;
DROP INDEX IF EXISTS public.tax_settings_tenant_bu_unique;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tenant_bu_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id);

-- 2) payroll_link: (tenant_id, payroll_month) → (+ business_unit_id)
ALTER TABLE public.payroll_link
  DROP CONSTRAINT IF EXISTS payroll_link_tenant_month_unique;
ALTER TABLE public.payroll_link
  DROP CONSTRAINT IF EXISTS payroll_link_tenant_bu_month_unique;
DROP INDEX IF EXISTS public.payroll_link_tenant_bu_month_unique;

ALTER TABLE public.payroll_link
  ADD CONSTRAINT payroll_link_tenant_bu_month_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id, payroll_month);

-- 3) month_end_close: (tenant_id, month) → (+ business_unit_id)
ALTER TABLE public.month_end_close
  DROP CONSTRAINT IF EXISTS month_end_close_tenant_month_unique;
ALTER TABLE public.month_end_close
  DROP CONSTRAINT IF EXISTS month_end_close_tenant_bu_month_unique;
DROP INDEX IF EXISTS public.month_end_close_tenant_bu_month_unique;

ALTER TABLE public.month_end_close
  ADD CONSTRAINT month_end_close_tenant_bu_month_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id, month);

-- 4) manual_financial_entries: (tenant_id, period_month) → (+ business_unit_id)
ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_tenant_period_unique;
ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_period_month_key;
ALTER TABLE public.manual_financial_entries
  DROP CONSTRAINT IF EXISTS manual_financial_entries_tenant_bu_period_unique;
DROP INDEX IF EXISTS public.manual_financial_entries_tenant_bu_period_unique;

ALTER TABLE public.manual_financial_entries
  ADD CONSTRAINT manual_financial_entries_tenant_bu_period_unique
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id, period_month);
