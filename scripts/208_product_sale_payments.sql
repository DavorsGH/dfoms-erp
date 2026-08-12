-- Script 208: Product sale payment audit log (manual Record Payment on CRM).
-- Apply staging first; production after verification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  income_id uuid NOT NULL REFERENCES public.income_register(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text,
  notes text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_sale_payments_income
  ON public.product_sale_payments (income_id);

CREATE INDEX IF NOT EXISTS idx_product_sale_payments_tenant_date
  ON public.product_sale_payments (tenant_id, payment_date DESC);

COMMENT ON TABLE public.product_sale_payments IS
  'Audit trail of money received against an existing product sale (income_register product_sale rows).';

DROP TRIGGER IF EXISTS trg_product_sale_payments_enforce_tenant_id
  ON public.product_sale_payments;
CREATE TRIGGER trg_product_sale_payments_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.product_sale_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION enforce_product_sale_payment_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_income_tenant uuid;
  v_entry_type text;
BEGIN
  SELECT tenant_id, entry_type::text
  INTO v_income_tenant, v_entry_type
  FROM income_register
  WHERE id = NEW.income_id;

  IF v_income_tenant IS NULL THEN
    RAISE EXCEPTION 'income_register % not found', NEW.income_id;
  END IF;

  IF v_entry_type <> 'product_sale' THEN
    RAISE EXCEPTION 'product_sale_payments.income_id must reference a product_sale income row';
  END IF;

  IF NEW.tenant_id <> v_income_tenant THEN
    RAISE EXCEPTION 'payment tenant_id must match income_register tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_sale_payment_tenant_match
  ON public.product_sale_payments;
CREATE TRIGGER trg_product_sale_payment_tenant_match
  BEFORE INSERT OR UPDATE OF income_id, tenant_id ON public.product_sale_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_product_sale_payment_tenant_match();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sale_payments TO authenticated;
GRANT ALL ON public.product_sale_payments TO service_role;

ALTER TABLE public.product_sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_sale_payments_tenant_select ON public.product_sale_payments;
CREATE POLICY product_sale_payments_tenant_select
  ON public.product_sale_payments
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS product_sale_payments_finance_write ON public.product_sale_payments;
CREATE POLICY product_sale_payments_finance_write
  ON public.product_sale_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND can_access_finance_income_data()
  );

DROP POLICY IF EXISTS product_sale_payments_finance_update ON public.product_sale_payments;
CREATE POLICY product_sale_payments_finance_update
  ON public.product_sale_payments
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_finance_income_data()
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND can_access_finance_income_data()
  );

DROP POLICY IF EXISTS product_sale_payments_finance_delete ON public.product_sale_payments;
CREATE POLICY product_sale_payments_finance_delete
  ON public.product_sale_payments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND can_access_finance_income_data()
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
