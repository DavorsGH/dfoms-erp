-- Script 111: Product sale Paystack payment requests (POS Request Payment).
-- Staging first. Maps Paystack references to POS invoices (multi-line income_register).

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_sale_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  invoice_no text NOT NULL,
  income_ids uuid[] NOT NULL,
  paystack_reference text,
  authorization_url text,
  amount_requested numeric(12, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'GHS',
  status text NOT NULL DEFAULT 'pending',
  payment_method text NOT NULL,
  delivery_email text,
  delivery_phone text,
  send_email boolean NOT NULL DEFAULT false,
  send_sms boolean NOT NULL DEFAULT false,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  email_error text,
  sms_error text,
  paid_amount numeric(12, 2),
  paid_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_sale_payment_requests_status_check
    CHECK (status IN ('pending', 'sent', 'paid', 'failed', 'cancelled')),
  CONSTRAINT product_sale_payment_requests_amount_positive
    CHECK (amount_requested > 0),
  CONSTRAINT product_sale_payment_requests_income_ids_nonempty
    CHECK (cardinality(income_ids) > 0),
  CONSTRAINT product_sale_payment_requests_channels_check
    CHECK (send_email OR send_sms)
);

COMMENT ON TABLE public.product_sale_payment_requests IS
  'Paystack one-off payment links for POS/product-sale invoices (not ERP Suite subscriptions).';

COMMENT ON COLUMN public.product_sale_payment_requests.income_ids IS
  'Active income_register product_sale row ids covered by this charge at request time.';

CREATE UNIQUE INDEX IF NOT EXISTS product_sale_payment_requests_paystack_reference_uidx
  ON public.product_sale_payment_requests (paystack_reference)
  WHERE paystack_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_sale_payment_requests_tenant_invoice_idx
  ON public.product_sale_payment_requests (tenant_id, invoice_no);

CREATE INDEX IF NOT EXISTS product_sale_payment_requests_tenant_status_idx
  ON public.product_sale_payment_requests (tenant_id, status);

DROP TRIGGER IF EXISTS trg_product_sale_payment_requests_enforce_tenant_id
  ON public.product_sale_payment_requests;
CREATE TRIGGER trg_product_sale_payment_requests_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.product_sale_payment_requests
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.product_sale_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_sale_payment_requests_tenant_select
  ON public.product_sale_payment_requests;
CREATE POLICY product_sale_payment_requests_tenant_select
  ON public.product_sale_payment_requests
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS product_sale_payment_requests_tenant_insert
  ON public.product_sale_payment_requests;
CREATE POLICY product_sale_payment_requests_tenant_insert
  ON public.product_sale_payment_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS product_sale_payment_requests_tenant_update
  ON public.product_sale_payment_requests;
CREATE POLICY product_sale_payment_requests_tenant_update
  ON public.product_sale_payment_requests
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS product_sale_payment_requests_tenant_delete
  ON public.product_sale_payment_requests;
CREATE POLICY product_sale_payment_requests_tenant_delete
  ON public.product_sale_payment_requests
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS product_sale_payment_requests_super_admin_full_access
  ON public.product_sale_payment_requests;
CREATE POLICY product_sale_payment_requests_super_admin_full_access
  ON public.product_sale_payment_requests
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sale_payment_requests
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_sale_payment_requests
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
