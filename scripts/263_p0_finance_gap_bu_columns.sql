-- 263_p0_finance_gap_bu_columns.sql
-- Phase 6b P0 gap: add business_unit_id to capital_contributions, budgets,
-- client_receipts, and client_invoice_payments.
-- Existing rows stay NULL (workspace default / untagged) — no backfill.
-- Safe to re-run. Apply staging first.

BEGIN;

-- ---------------------------------------------------------------------------
-- capital_contributions
-- ---------------------------------------------------------------------------
ALTER TABLE public.capital_contributions
  ADD COLUMN IF NOT EXISTS business_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'capital_contributions_business_unit_id_fkey'
  ) THEN
    ALTER TABLE public.capital_contributions
      ADD CONSTRAINT capital_contributions_business_unit_id_fkey
      FOREIGN KEY (business_unit_id) REFERENCES public.business_units (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_capital_contributions_tenant_bu
  ON public.capital_contributions (tenant_id, business_unit_id);

-- ---------------------------------------------------------------------------
-- budgets (+ rebuild unique period index to include business_unit_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS business_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'budgets_business_unit_id_fkey'
  ) THEN
    ALTER TABLE public.budgets
      ADD CONSTRAINT budgets_business_unit_id_fkey
      FOREIGN KEY (business_unit_id) REFERENCES public.business_units (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_budgets_tenant_bu
  ON public.budgets (tenant_id, business_unit_id);

DROP INDEX IF EXISTS public.budgets_unique_period;

CREATE UNIQUE INDEX budgets_unique_period ON public.budgets USING btree (
  tenant_id,
  COALESCE(business_unit_id::text, ''::text),
  COALESCE(project_id::text, ''::text),
  category,
  COALESCE(subcategory, ''::text),
  period_month,
  period_type
);

-- ---------------------------------------------------------------------------
-- client_receipts
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_receipts
  ADD COLUMN IF NOT EXISTS business_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_receipts_business_unit_id_fkey'
  ) THEN
    ALTER TABLE public.client_receipts
      ADD CONSTRAINT client_receipts_business_unit_id_fkey
      FOREIGN KEY (business_unit_id) REFERENCES public.business_units (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_receipts_tenant_bu
  ON public.client_receipts (tenant_id, business_unit_id);

-- ---------------------------------------------------------------------------
-- client_invoice_payments
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_invoice_payments
  ADD COLUMN IF NOT EXISTS business_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_invoice_payments_business_unit_id_fkey'
  ) THEN
    ALTER TABLE public.client_invoice_payments
      ADD CONSTRAINT client_invoice_payments_business_unit_id_fkey
      FOREIGN KEY (business_unit_id) REFERENCES public.business_units (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_invoice_payments_tenant_bu
  ON public.client_invoice_payments (tenant_id, business_unit_id);

COMMIT;
