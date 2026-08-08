-- Script 177: AP payment ledger (company cash vs director-personal) + RLS + backfill.
-- Apply staging first; production after verification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.accounts_payable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  accounts_payable_id uuid NOT NULL REFERENCES public.accounts_payable(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_source text NOT NULL CHECK (payment_source IN ('company_cash', 'directors_loan')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_ap_payments_payable
  ON public.accounts_payable_payments (accounts_payable_id);

CREATE INDEX IF NOT EXISTS idx_ap_payments_tenant_date
  ON public.accounts_payable_payments (tenant_id, payment_date);

COMMENT ON TABLE public.accounts_payable_payments IS
  'Settlement events for accounts payable. company_cash hits cash; directors_loan increases Director''s Loan liability.';

DROP TRIGGER IF EXISTS trg_accounts_payable_payments_enforce_tenant_id
  ON public.accounts_payable_payments;
CREATE TRIGGER trg_accounts_payable_payments_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.accounts_payable_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION enforce_ap_payment_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ap_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_ap_tenant
  FROM accounts_payable
  WHERE id = NEW.accounts_payable_id;

  IF v_ap_tenant IS NULL THEN
    RAISE EXCEPTION 'accounts_payable % not found', NEW.accounts_payable_id;
  END IF;

  IF NEW.tenant_id <> v_ap_tenant THEN
    RAISE EXCEPTION 'payment tenant_id must match accounts_payable tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ap_payment_tenant_match ON public.accounts_payable_payments;
CREATE TRIGGER trg_ap_payment_tenant_match
  BEFORE INSERT OR UPDATE OF accounts_payable_id, tenant_id ON public.accounts_payable_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ap_payment_tenant_match();

-- Backfill legacy cumulative amount_paid as company_cash at invoice_date.
INSERT INTO public.accounts_payable_payments (
  tenant_id,
  accounts_payable_id,
  payment_date,
  amount,
  payment_source,
  notes
)
SELECT
  ap.tenant_id,
  ap.id,
  COALESCE(ap.invoice_date, CURRENT_DATE),
  ap.amount_paid,
  'company_cash',
  'Migrated: pre-payment-ledger cumulative amount_paid'
FROM public.accounts_payable ap
WHERE COALESCE(ap.amount_paid, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.accounts_payable_payments p
    WHERE p.accounts_payable_id = ap.id
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_payable_payments TO authenticated;
GRANT ALL ON public.accounts_payable_payments TO service_role;

ALTER TABLE public.accounts_payable_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_payable_payments_tenant_select ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_select
  ON public.accounts_payable_payments
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS accounts_payable_payments_tenant_insert ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_insert
  ON public.accounts_payable_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

DROP POLICY IF EXISTS accounts_payable_payments_tenant_update ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_update
  ON public.accounts_payable_payments
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

DROP POLICY IF EXISTS accounts_payable_payments_tenant_delete ON public.accounts_payable_payments;
CREATE POLICY accounts_payable_payments_tenant_delete
  ON public.accounts_payable_payments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

CREATE OR REPLACE FUNCTION recompute_accounts_payable_from_payments(p_ap_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_paid numeric;
  v_balance numeric;
  v_due date;
  v_days int;
  v_status text;
BEGIN
  SELECT amount, due_date
  INTO v_amount, v_due
  FROM accounts_payable
  WHERE id = p_ap_id;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_paid
  FROM accounts_payable_payments
  WHERE accounts_payable_id = p_ap_id;

  v_balance := GREATEST(COALESCE(v_amount, 0) - COALESCE(v_paid, 0), 0);
  v_days := GREATEST(CURRENT_DATE - COALESCE(v_due, CURRENT_DATE), 0);

  IF v_balance = 0 THEN
    v_status := 'Paid';
  ELSIF v_due IS NOT NULL AND v_due < CURRENT_DATE THEN
    v_status := 'Overdue';
  ELSE
    v_status := 'Outstanding';
  END IF;

  UPDATE accounts_payable
  SET
    amount_paid = v_paid,
    balance_due = v_balance,
    status = v_status
  WHERE id = p_ap_id;
END;
$$;

GRANT EXECUTE ON FUNCTION recompute_accounts_payable_from_payments(uuid) TO authenticated, service_role;

COMMIT;
