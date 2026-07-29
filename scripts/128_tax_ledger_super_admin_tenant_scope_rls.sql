-- Script 128: Close cross-tenant leak on tax tables (script 113 regression).
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Root cause: scripts/113_tax_settings_ledger.sql created
--   *_super_admin_full_access policies with
--     USING (is_super_admin()) / WITH CHECK (is_super_admin())
-- and NO tenant_matches(tenant_id). Permissive RLS ORs policies, so any
-- tenant-owner super_admin (e.g. info@caanta.com) SELECTs ALL tenants'
-- tax_ledger_entries — which surfaced on Caanta Balance Sheet as Davors'
-- Net VAT 9002.31 / WHT 2353.55 / PAYE / SSNIT.
--
-- Same class of bug as pre-script-69 and script 117 (fixed by 118).
--
-- Sweep of scripts 113–126 (source):
--   113 — LEAKY: tax_settings, tax_rate_catalog, tax_ledger_entries (this fix)
--   114 — no RLS policy changes
--   115 — admin RPC only (service_role)
--   116 — no SA full-access policy
--   117 — source now has tenant_matches AND; live DBs remediates via 118
--   118 — already correct (salary settings remediation)
--   119 — correct from day one (leave_entitlement_policy)
--   125–126 — no SA full-access policies
--
-- Fix: match script 69 / 60 / 118 pattern —
--   USING (tenant_matches(tenant_id) AND is_super_admin())
-- System tax_rate_catalog seeds (tenant_id IS NULL) remain readable via
-- tax_rate_catalog_tenant_select (tenant_matches OR tenant_id IS NULL).

BEGIN;

DROP POLICY IF EXISTS tax_settings_super_admin_full_access
  ON public.tax_settings;
CREATE POLICY tax_settings_super_admin_full_access
  ON public.tax_settings
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS tax_rate_catalog_super_admin_full_access
  ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_super_admin_full_access
  ON public.tax_rate_catalog
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS tax_ledger_entries_super_admin_full_access
  ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_super_admin_full_access
  ON public.tax_ledger_entries
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

COMMIT;
