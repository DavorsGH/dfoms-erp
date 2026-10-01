BEGIN;

ALTER TABLE public.statutory_gra_reconciliation
  ADD COLUMN IF NOT EXISTS penalty_expense_id uuid REFERENCES public.expense_register (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS statutory_gra_reconciliation_penalty_expense_id_idx
  ON public.statutory_gra_reconciliation (penalty_expense_id)
  WHERE penalty_expense_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
