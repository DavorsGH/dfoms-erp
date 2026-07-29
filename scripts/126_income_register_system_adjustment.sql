-- 126_income_register_system_adjustment.sql
-- Non-cash system adjustments (payroll DEDSAV, forfeited-wage ADJ, etc.) must
-- never carry AR outstanding or VAT/WHT tax_ledger legs. The Income Register UI
-- recalculates tax + outstanding on every save; an explicit flag lets the UI
-- and a DB trigger refuse that reshape.
--
-- Idempotent. Apply to staging first, then production.

BEGIN;

ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS is_system_adjustment boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.income_register.is_system_adjustment IS
  'When true, row is a non-cash system P&L adjustment (e.g. PAYROLL-DEDSAV, ADJ-forfeit). '
  'Must keep outstanding_balance=0 and no VAT/WHT tax_ledger_entries. Protected by '
  'trg_protect_system_adjustment_income + Income Register UI.';

CREATE INDEX IF NOT EXISTS income_register_system_adjustment_idx
  ON public.income_register (tenant_id, is_system_adjustment)
  WHERE is_system_adjustment = true;

-- Force non-cash untaxed shape on INSERT/UPDATE for flagged rows.
CREATE OR REPLACE FUNCTION public.protect_system_adjustment_income()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_system_adjustment IS TRUE THEN
    NEW.outstanding_balance := 0;
    NEW.amount_received := COALESCE(NEW.amount_received, 0);
    NEW.output_vat_amount := 0;
    NEW.output_tax_component := NULL;
    NEW.wht_rate := NULL;
    NEW.wht_amount := 0;
    NEW.net_of_tax_amount := NEW.amount;
    -- Keep tax_inclusive true so a later UI reopen does not treat amount as net
    -- and add VAT on top if the flag were ever cleared incorrectly.
    NEW.tax_inclusive := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_adjustment_income
  ON public.income_register;
CREATE TRIGGER trg_protect_system_adjustment_income
  BEFORE INSERT OR UPDATE ON public.income_register
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_system_adjustment_income();

-- Drop any tax_ledger legs that would otherwise stick after a UI save race.
CREATE OR REPLACE FUNCTION public.clear_system_adjustment_tax_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_system_adjustment IS TRUE THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_system_adjustment_tax_ledger
  ON public.income_register;
CREATE TRIGGER trg_clear_system_adjustment_tax_ledger
  AFTER INSERT OR UPDATE ON public.income_register
  FOR EACH ROW
  WHEN (NEW.is_system_adjustment IS TRUE)
  EXECUTE FUNCTION public.clear_system_adjustment_tax_ledger();

-- Income Register UI syncs tax AFTER the income UPDATE. Block those inserts
-- when the source income row is a system adjustment.
CREATE OR REPLACE FUNCTION public.block_tax_ledger_for_system_adjustment_income()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_type = 'income_register' AND NEW.source_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.income_register i
      WHERE i.id = NEW.source_id
        AND i.is_system_adjustment IS TRUE
    ) THEN
      RETURN NULL; -- cancel this tax_ledger insert
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_tax_ledger_for_system_adjustment_income
  ON public.tax_ledger_entries;
CREATE TRIGGER trg_block_tax_ledger_for_system_adjustment_income
  BEFORE INSERT ON public.tax_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.block_tax_ledger_for_system_adjustment_income();

COMMIT;
