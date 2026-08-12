-- 210_client_quotations_tax_basis.sql
-- Per-quotation VAT/WHT calculation basis (independent of tenant-wide invoice setting).

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS tax_basis text;

UPDATE public.client_quotations
SET tax_basis = CASE
  WHEN quotation_type = 'product' THEN 'total_cost'
  ELSE 'service_only'
END
WHERE tax_basis IS NULL;

ALTER TABLE public.client_quotations
  ALTER COLUMN tax_basis SET DEFAULT 'service_only';

ALTER TABLE public.client_quotations
  ALTER COLUMN tax_basis SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_quotations_tax_basis_check'
  ) THEN
    ALTER TABLE public.client_quotations
      ADD CONSTRAINT client_quotations_tax_basis_check
      CHECK (tax_basis IN ('service_only', 'total_cost'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_quotations' AND column_name = 'tax_basis'
  ) THEN
    RAISE EXCEPTION 'client_quotations.tax_basis column missing after migration';
  END IF;
  RAISE NOTICE 'Script 210 complete: client_quotations.tax_basis added.';
END $$;

COMMIT;
