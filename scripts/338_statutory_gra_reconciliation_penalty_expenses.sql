BEGIN;

CREATE TABLE IF NOT EXISTS public.statutory_gra_reconciliation_penalty_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.statutory_gra_reconciliation (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  penalty_expense_id uuid NOT NULL REFERENCES public.expense_register (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statutory_gra_reconciliation_penalty_expenses_reconciliation_expense_key
    UNIQUE (reconciliation_id, penalty_expense_id)
);

CREATE INDEX IF NOT EXISTS statutory_gra_reconciliation_penalty_expenses_reconciliation_id_idx
  ON public.statutory_gra_reconciliation_penalty_expenses (reconciliation_id);

CREATE INDEX IF NOT EXISTS statutory_gra_reconciliation_penalty_expenses_tenant_id_idx
  ON public.statutory_gra_reconciliation_penalty_expenses (tenant_id);

INSERT INTO public.statutory_gra_reconciliation_penalty_expenses (
  reconciliation_id,
  tenant_id,
  penalty_expense_id
)
SELECT
  r.id,
  r.tenant_id,
  r.penalty_expense_id
FROM public.statutory_gra_reconciliation r
WHERE r.penalty_expense_id IS NOT NULL
ON CONFLICT ON CONSTRAINT statutory_gra_reconciliation_penalty_expenses_reconciliation_expense_key
DO NOTHING;

DROP TRIGGER IF EXISTS trg_statutory_gra_reconciliation_penalty_expenses_enforce_tenant_id
  ON public.statutory_gra_reconciliation_penalty_expenses;
CREATE TRIGGER trg_statutory_gra_reconciliation_penalty_expenses_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.statutory_gra_reconciliation_penalty_expenses
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.statutory_gra_reconciliation_penalty_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_gra_reconciliation_penalty_expenses_tenant_all
  ON public.statutory_gra_reconciliation_penalty_expenses;
CREATE POLICY statutory_gra_reconciliation_penalty_expenses_tenant_all
  ON public.statutory_gra_reconciliation_penalty_expenses
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS statutory_gra_reconciliation_penalty_expenses_super_admin_full_access
  ON public.statutory_gra_reconciliation_penalty_expenses;
CREATE POLICY statutory_gra_reconciliation_penalty_expenses_super_admin_full_access
  ON public.statutory_gra_reconciliation_penalty_expenses
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_gra_reconciliation_penalty_expenses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_gra_reconciliation_penalty_expenses TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
