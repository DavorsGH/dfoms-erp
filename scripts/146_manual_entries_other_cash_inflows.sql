-- Script 146: Other Cash Inflows on manual_financial_entries
--
-- Cash-flow manual inflow (catch-all) consumed by buildMonthlyCashComponents /
-- Cash Flow Statement. Pair with loan_proceeds for financing-specific inflows.
--
-- Apply on staging first, then production. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE public.manual_financial_entries
  ADD COLUMN IF NOT EXISTS other_cash_inflows numeric(12,2) DEFAULT 0;

COMMENT ON COLUMN public.manual_financial_entries.other_cash_inflows IS
  'Manual catch-all cash inflow for the month (not income register, capital contributions, or loan proceeds).';

NOTIFY pgrst, 'reload schema';

COMMIT;
