-- Script 144: Director's Loan liability on manual_financial_entries
--
-- Month-end outstanding balance (stock) for owner/director loans repayable
-- to the director — separate from bank_loans and other_long_term_liabilities.
-- Pair with loan_proceeds / loan_repayments for Cash / Cash Flow.
--
-- Apply on staging first. Safe to re-run (IF NOT EXISTS).

BEGIN;

ALTER TABLE public.manual_financial_entries
  ADD COLUMN IF NOT EXISTS directors_loan numeric(12,2) DEFAULT 0;

COMMENT ON COLUMN public.manual_financial_entries.directors_loan IS
  'Month-end outstanding Director''s Loan / Due to Owner liability (stock). Not equity.';

COMMIT;
