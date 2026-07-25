-- Script 114: Tax ledger payroll / statutory remittance schema (additive to 113).
-- Definition only. Do NOT apply to staging or production until explicitly approved.
--
-- Extends:
--   tax_ledger_entries  — payroll statutory components, remitted_at, payroll_period source
--   tax_settings        — PAYE / SSNIT Tier 1 / Tier 2 due-day defaults and next-due dates
--
-- Locked decisions (David):
--   1. Remittance system-of-record = tax_ledger_entries (Option A). Soft-deprecate
--      SSNIT/PAYE AP auto-post later in app code; this migration is schema only.
--      Historical accounts_payable rows are left untouched.
--   2. Payroll grain = period aggregate: one ledger row per
--      (tenant, payroll period, direction, tax_component). source_type = 'payroll_period';
--      source_id points at the payroll period aggregate id (app wiring later).
--   3. Tier 2 is separate from SSNIT Tier 1 employer:
--      tax_component 'ssnit_employer_tier1' vs 'ssnit_tier2'.
--   4. VAT reminders: intended assumption is "last working day of the month" —
--      CONFIRM WITH ACCOUNTANT. Do not store a broken integer for last-working-day;
--      keep vat_return_due_day / next_vat_due_date as in 113; app computes last
--      working day for reminders.
--
-- Due-day defaults (paye 15, ssnit/tier2 14) are provisional — CONFIRM WITH ACCOUNTANT.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. tax_ledger_entries — columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_ledger_entries
  ADD COLUMN IF NOT EXISTS remitted_at date;

COMMENT ON COLUMN public.tax_ledger_entries.remitted_at IS
  'Date remitted to GRA/SSNIT (or equivalent). Preferred over parsing notes. '
  'UI historically stamped notes as [Remitted YYYY-MM-DD] when status became paid.';

COMMENT ON COLUMN public.tax_ledger_entries.direction IS
  'output = output vat_bundle/VFRS liability; input = input VAT credit; '
  'wht_receivable = client-withheld; wht_payable = supplier-withheld; '
  'settlement = GRA remittance / clearance; '
  'statutory_payable = payroll statutory accrual (PAYE / SSNIT Tier 1 / Tier 2) '
  'at period-aggregate grain (source_type = payroll_period).';

COMMENT ON COLUMN public.tax_ledger_entries.tax_component IS
  'vat_bundle = service VAT/NHIL/GETFund/COVID; vfrs = goods VFRS; wht = withholding; '
  'paye = PAYE; ssnit_employee = employee SSNIT; ssnit_employer_tier1 = employer SSNIT Tier 1; '
  'ssnit_tier2 = Tier 2 (separate from Tier 1).';

COMMENT ON COLUMN public.tax_ledger_entries.source_type IS
  'Origin of the ledger row. payroll_period = payroll period aggregate '
  '(not per-employee); one active row per tenant/period/direction/component.';

COMMENT ON TABLE public.tax_ledger_entries IS
  'Transactional tax ledger feeding Balance Sheet VAT/WHT/statutory balances and GRA period views. '
  'Services use vat_bundle; product-sale goods use VFRS; payroll statutory uses period-aggregate '
  'rows (source_type = payroll_period). Remittance SoR is this ledger (Option A).';

-- ---------------------------------------------------------------------------
-- 2. tax_ledger_entries — expand CHECKs (drop by name, then recreate)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_ledger_entries
  DROP CONSTRAINT IF EXISTS tax_ledger_entries_direction_check;

ALTER TABLE public.tax_ledger_entries
  ADD CONSTRAINT tax_ledger_entries_direction_check
  CHECK (direction IN (
    'output',
    'input',
    'wht_receivable',
    'wht_payable',
    'settlement',
    'statutory_payable'
  ));

ALTER TABLE public.tax_ledger_entries
  DROP CONSTRAINT IF EXISTS tax_ledger_entries_tax_component_check;

ALTER TABLE public.tax_ledger_entries
  ADD CONSTRAINT tax_ledger_entries_tax_component_check
  CHECK (tax_component IN (
    'vat_bundle',
    'vfrs',
    'wht',
    'paye',
    'ssnit_employee',
    'ssnit_employer_tier1',
    'ssnit_tier2'
  ));

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
    'payroll_period'
  ));

-- Direction ↔ component pairing. settlement may clear any component (incl. statutory).
-- Safe for 113 rows: output/input×vat_bundle|vfrs, wht_*×wht, settlement×{vat_bundle,vfrs,wht}.
ALTER TABLE public.tax_ledger_entries
  DROP CONSTRAINT IF EXISTS tax_ledger_entries_direction_component_check;

ALTER TABLE public.tax_ledger_entries
  ADD CONSTRAINT tax_ledger_entries_direction_component_check
  CHECK (
    (
      direction = 'statutory_payable'
      AND tax_component IN (
        'paye',
        'ssnit_employee',
        'ssnit_employer_tier1',
        'ssnit_tier2'
      )
    )
    OR (
      direction IN ('wht_receivable', 'wht_payable')
      AND tax_component = 'wht'
    )
    OR (
      direction IN ('output', 'input')
      AND tax_component IN ('vat_bundle', 'vfrs')
    )
    OR (
      direction = 'settlement'
      AND tax_component IN (
        'vat_bundle',
        'vfrs',
        'wht',
        'paye',
        'ssnit_employee',
        'ssnit_employer_tier1',
        'ssnit_tier2'
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Unique partial index (active rows only; skip NULL source_id)
-- ---------------------------------------------------------------------------
-- Postgres UNIQUE treats NULL source_id as distinct, so manual/settlement rows with
-- NULL source_id would not collide anyway. Restricting to source_id IS NOT NULL
-- documents intent: uniqueness applies to linked source documents / payroll periods.
CREATE UNIQUE INDEX IF NOT EXISTS tax_ledger_entries_active_source_component_uidx
  ON public.tax_ledger_entries (
    tenant_id,
    source_type,
    source_id,
    direction,
    tax_component
  )
  WHERE status <> 'reversed'
    AND source_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Backfill remitted_at from historical notes stamp
-- ---------------------------------------------------------------------------
UPDATE public.tax_ledger_entries
SET
  remitted_at = (substring(notes FROM '\[Remitted (\d{4}-\d{2}-\d{2})\]'))::date,
  updated_at = now()
WHERE status = 'paid'
  AND remitted_at IS NULL
  AND notes ~ '\[Remitted \d{4}-\d{2}-\d{2}\]';

-- ---------------------------------------------------------------------------
-- 5. tax_settings — payroll / statutory due days (VAT fields unchanged)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS paye_return_due_day integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ssnit_return_due_day integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS tier2_return_due_day integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS next_paye_due_date date,
  ADD COLUMN IF NOT EXISTS next_ssnit_due_date date,
  ADD COLUMN IF NOT EXISTS next_tier2_due_date date;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_paye_return_due_day_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_paye_return_due_day_check
  CHECK (paye_return_due_day >= 1 AND paye_return_due_day <= 31);

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_ssnit_return_due_day_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_ssnit_return_due_day_check
  CHECK (ssnit_return_due_day >= 1 AND ssnit_return_due_day <= 31);

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tier2_return_due_day_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tier2_return_due_day_check
  CHECK (tier2_return_due_day >= 1 AND tier2_return_due_day <= 31);

COMMENT ON COLUMN public.tax_settings.paye_return_due_day IS
  'Day-of-month target for PAYE return/remittance reminders (default 15). '
  'PROVISIONAL — CONFIRM WITH ACCOUNTANT before relying on reminders.';

COMMENT ON COLUMN public.tax_settings.ssnit_return_due_day IS
  'Day-of-month target for SSNIT Tier 1 return/remittance reminders (default 14). '
  'PROVISIONAL — CONFIRM WITH ACCOUNTANT before relying on reminders.';

COMMENT ON COLUMN public.tax_settings.tier2_return_due_day IS
  'Day-of-month target for Tier 2 return/remittance reminders (default 14). '
  'PROVISIONAL / Tier 2 scheme details — CONFIRM WITH ACCOUNTANT.';

COMMENT ON COLUMN public.tax_settings.next_paye_due_date IS
  'Cached next PAYE due date for reminders; maintained by app when wiring exists.';

COMMENT ON COLUMN public.tax_settings.next_ssnit_due_date IS
  'Cached next SSNIT Tier 1 due date for reminders; maintained by app when wiring exists.';

COMMENT ON COLUMN public.tax_settings.next_tier2_due_date IS
  'Cached next Tier 2 due date for reminders; maintained by app when wiring exists.';

COMMENT ON COLUMN public.tax_settings.vat_return_due_day IS
  'Optional calendar day-of-month for VAT (legacy/simple). Intended reminder assumption '
  'is last working day of the month — CONFIRM WITH ACCOUNTANT. App should compute last '
  'working day for VAT reminders; do not encode last-working-day as this integer.';

COMMENT ON COLUMN public.tax_settings.next_vat_due_date IS
  'Cached next VAT due date. Prefer app-computed last working day when reminder_enabled; '
  'CONFIRM last-working-day assumption WITH ACCOUNTANT.';

-- No RLS changes: tax_settings / tax_ledger_entries policies from 113 already cover new columns.
-- No lock-period or accounts_payable behavior changes in this script.

NOTIFY pgrst, 'reload schema';

COMMIT;
