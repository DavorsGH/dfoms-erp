BEGIN;

CREATE TABLE IF NOT EXISTS public.directors_loan_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  entry_type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  description text NOT NULL,
  reference text,
  notes text,
  linked_expense_id uuid REFERENCES public.expense_register(id) ON DELETE SET NULL,
  reversed_at timestamptz,
  reversed_by uuid REFERENCES auth.users(id),
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT directors_loan_entries_entry_type_check
    CHECK (
      entry_type IN (
        'director_lent_company',
        'company_repaid_director',
        'company_paid_for_director',
        'director_repaid_company'
      )
    ),
  CONSTRAINT directors_loan_entries_amount_positive CHECK (amount > 0),
  CONSTRAINT directors_loan_entries_description_nonempty CHECK (length(trim(description)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_directors_loan_entries_tenant_date
  ON public.directors_loan_entries (tenant_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_directors_loan_entries_tenant_bu_date
  ON public.directors_loan_entries (tenant_id, business_unit_id, entry_date);

CREATE INDEX IF NOT EXISTS idx_directors_loan_entries_linked_expense
  ON public.directors_loan_entries (linked_expense_id)
  WHERE linked_expense_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_directors_loan_entries_enforce_tenant_id
  ON public.directors_loan_entries;
CREATE TRIGGER trg_directors_loan_entries_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.directors_loan_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

GRANT SELECT, INSERT, UPDATE ON public.directors_loan_entries TO authenticated;
GRANT ALL ON public.directors_loan_entries TO service_role;

ALTER TABLE public.directors_loan_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS directors_loan_entries_tenant_select ON public.directors_loan_entries;
CREATE POLICY directors_loan_entries_tenant_select
  ON public.directors_loan_entries
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS directors_loan_entries_tenant_insert ON public.directors_loan_entries;
CREATE POLICY directors_loan_entries_tenant_insert
  ON public.directors_loan_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

DROP POLICY IF EXISTS directors_loan_entries_tenant_update ON public.directors_loan_entries;
CREATE POLICY directors_loan_entries_tenant_update
  ON public.directors_loan_entries
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

COMMIT;
