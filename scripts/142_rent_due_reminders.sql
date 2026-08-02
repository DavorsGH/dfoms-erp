-- Script 142: Rent-due reminder dedup column
--
-- Adds reminders_sent (jsonb array of fired milestone day-counts) on
-- rent_ledger so the rent-due reminder cron can skip milestones already
-- notified for a given ledger row. Safe to re-run. Apply on staging first.
--
-- Related app path: /api/cron/rent-due-reminders
-- Outstanding balance (app-side): amount_due_ghs - amount_paid_ghs - coalesce(credit_ghs, 0)
-- Note: credit_ghs was added in script 134; treat null as 0 if an older DB
-- has not applied 134 yet.

BEGIN;

ALTER TABLE public.rent_ledger
  ADD COLUMN IF NOT EXISTS reminders_sent jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rent_ledger.reminders_sent IS
  'JSON array of rent-due reminder milestone day-counts already fired for this '
  'ledger row (e.g. [90, 30, 7]). Used by cron rent-due-reminders for dedup.';

CREATE INDEX IF NOT EXISTS idx_rent_ledger_due_reminders
  ON public.rent_ledger (tenant_id, period_end)
  WHERE status IS DISTINCT FROM 'paid'
    AND period_end IS NOT NULL;

COMMIT;
