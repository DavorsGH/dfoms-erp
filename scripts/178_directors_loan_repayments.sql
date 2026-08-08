-- Script 178: Director's Loan repayments ledger + RLS.
-- Apply staging first; production after verification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.directors_loan_repayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  repayment_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  applied_to_ap_component numeric(12, 2) NOT NULL DEFAULT 0,
  applied_to_manual_component numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_dlr_tenant_date
  ON public.directors_loan_repayments (tenant_id, repayment_date);

COMMENT ON TABLE public.directors_loan_repayments IS
  'Company cash repayments to director. Reduces net Director''s Loan; creates cash outflow.';

DROP TRIGGER IF EXISTS trg_directors_loan_repayments_enforce_tenant_id
  ON public.directors_loan_repayments;
CREATE TRIGGER trg_directors_loan_repayments_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.directors_loan_repayments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.directors_loan_repayments TO authenticated;
GRANT ALL ON public.directors_loan_repayments TO service_role;

ALTER TABLE public.directors_loan_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS directors_loan_repayments_tenant_select ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_select
  ON public.directors_loan_repayments
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS directors_loan_repayments_tenant_insert ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_insert
  ON public.directors_loan_repayments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

DROP POLICY IF EXISTS directors_loan_repayments_tenant_update ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_update
  ON public.directors_loan_repayments
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

DROP POLICY IF EXISTS directors_loan_repayments_tenant_delete ON public.directors_loan_repayments;
CREATE POLICY directors_loan_repayments_tenant_delete
  ON public.directors_loan_repayments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

COMMIT;
