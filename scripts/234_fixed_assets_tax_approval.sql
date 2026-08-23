-- =============================================================================
-- 234_fixed_assets_tax_approval.sql
--
-- DO NOT apply to production without explicit approval.
-- Apply to staging first via scripts/apply-234-fixed-assets-tax-approval-staging.ts
--
-- Adds Fixed Assets purchase tax + approval columns (mirrors expense_register 113)
-- and extends tax_ledger_entries.source_type for fixed_asset rows.
--
-- Also widens tax_ledger_entries.source_id from uuid → text so Fixed Assets can
-- link by asset_id (text business key). Existing UUID source_ids cast cleanly.
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS gross_before_wht numeric(12, 2),
  ADD COLUMN IF NOT EXISTS wht_rate numeric(5, 2),
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS input_vat_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS net_of_tax_amount numeric(12, 2);

COMMENT ON COLUMN public.fixed_assets.approved_by IS
  'Approver full name (free text, same pattern as expense_register.approved_by).';

COMMENT ON COLUMN public.fixed_assets.gross_before_wht IS
  'Purchase gross before WHT (typically total_cost). Used when purchase tax checkbox is set.';

COMMENT ON COLUMN public.fixed_assets.wht_rate IS
  'Withholding tax rate (%), when purchase has WHT/VAT.';

COMMENT ON COLUMN public.fixed_assets.wht_amount IS
  'Withholding tax amount (GHS), when purchase has WHT/VAT.';

COMMENT ON COLUMN public.fixed_assets.input_vat_amount IS
  'Reclaimable input VAT/NHIL/GETFund on the asset purchase.';

COMMENT ON COLUMN public.fixed_assets.net_of_tax_amount IS
  'Gross minus input VAT — P&L / capitalization base when tax applies.';

ALTER TABLE public.tax_ledger_entries
  DROP CONSTRAINT IF EXISTS tax_ledger_entries_source_type_check;

ALTER TABLE public.tax_ledger_entries
  ADD CONSTRAINT tax_ledger_entries_source_type_check
  CHECK (source_type IN (
    'income_register',
    'client_invoice',
    'expense_register',
    'accounts_payable',
    'product_sale',
    'manual',
    'settlement',
    'payroll_period',
    'fixed_asset'
  ));

-- fixed_assets.asset_id is text (not uuid). Widen source_id so FA tax rows can
-- reference the business key. UUID values from other source_types remain valid
-- as text. Idempotent: skip if already text.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tax_ledger_entries'
      AND column_name = 'source_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.tax_ledger_entries
      ALTER COLUMN source_id TYPE text USING source_id::text;
  END IF;
END $$;

COMMENT ON COLUMN public.tax_ledger_entries.source_id IS
  'Source record id — uuid text for most registers; fixed_assets.asset_id for source_type=fixed_asset.';

COMMIT;
