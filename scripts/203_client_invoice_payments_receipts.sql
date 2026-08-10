-- Script 203: Client invoice payments + receipts + tenant signature branding.
-- Apply staging first; production after verification.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tenant signature branding (same storage bucket pattern as logo_url)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS signature_url TEXT,
  ADD COLUMN IF NOT EXISTS signature_author_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_author_title TEXT;

COMMENT ON COLUMN public.tenants.signature_url IS
  'Storage path in tenant-logos bucket for authorized-signer image on invoices/receipts.';
COMMENT ON COLUMN public.tenants.signature_author_name IS
  'Default printed name on payment receipts when a payment is recorded.';
COMMENT ON COLUMN public.tenants.signature_author_title IS
  'Default printed title on payment receipts when a payment is recorded.';

GRANT UPDATE (
  name,
  logo_url,
  signature_url,
  signature_author_name,
  signature_author_title,
  address,
  phone,
  email,
  updated_at
) ON public.tenants TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. client_invoice_payments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  payment_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text,
  notes text,
  recorded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_invoice_payments_invoice
  ON public.client_invoice_payments (invoice_id);

CREATE INDEX IF NOT EXISTS idx_client_invoice_payments_tenant_date
  ON public.client_invoice_payments (tenant_id, payment_date DESC);

COMMENT ON TABLE public.client_invoice_payments IS
  'Actual money received against a client invoice; drives amount_received and Income Register sync.';

DROP TRIGGER IF EXISTS trg_client_invoice_payments_enforce_tenant_id
  ON public.client_invoice_payments;
CREATE TRIGGER trg_client_invoice_payments_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.client_invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION enforce_client_invoice_payment_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_invoice_tenant
  FROM client_invoices
  WHERE id = NEW.invoice_id;

  IF v_invoice_tenant IS NULL THEN
    RAISE EXCEPTION 'client_invoices % not found', NEW.invoice_id;
  END IF;

  IF NEW.tenant_id <> v_invoice_tenant THEN
    RAISE EXCEPTION 'payment tenant_id must match invoice tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_invoice_payment_tenant_match
  ON public.client_invoice_payments;
CREATE TRIGGER trg_client_invoice_payment_tenant_match
  BEFORE INSERT OR UPDATE OF invoice_id, tenant_id ON public.client_invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION enforce_client_invoice_payment_tenant_match();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_invoice_payments TO authenticated;
GRANT ALL ON public.client_invoice_payments TO service_role;

ALTER TABLE public.client_invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_invoice_payments_tenant_select ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_tenant_select
  ON public.client_invoice_payments
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS client_invoice_payments_finance_write ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_write
  ON public.client_invoice_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

DROP POLICY IF EXISTS client_invoice_payments_finance_update ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_update
  ON public.client_invoice_payments
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

DROP POLICY IF EXISTS client_invoice_payments_finance_delete ON public.client_invoice_payments;
CREATE POLICY client_invoice_payments_finance_delete
  ON public.client_invoice_payments
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

-- ---------------------------------------------------------------------------
-- 3. client_receipts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.client_invoice_payments(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  receipt_sequence int NOT NULL,
  receipt_date date NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  payment_method text,
  notes text,
  authorized_by_name text,
  authorized_by_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_sequence),
  UNIQUE (tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_client_receipts_invoice
  ON public.client_receipts (invoice_id);

CREATE INDEX IF NOT EXISTS idx_client_receipts_payment
  ON public.client_receipts (payment_id);

CREATE INDEX IF NOT EXISTS idx_client_receipts_tenant_date
  ON public.client_receipts (tenant_id, receipt_date DESC);

COMMENT ON TABLE public.client_receipts IS
  'Formal receipt document issued per client invoice payment (number via generate_next_code RCPT).';

DROP TRIGGER IF EXISTS trg_client_receipts_enforce_tenant_id ON public.client_receipts;
CREATE TRIGGER trg_client_receipts_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.client_receipts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION enforce_client_receipt_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice_tenant uuid;
  v_payment_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_invoice_tenant
  FROM client_invoices
  WHERE id = NEW.invoice_id;

  IF v_invoice_tenant IS NULL THEN
    RAISE EXCEPTION 'client_invoices % not found', NEW.invoice_id;
  END IF;

  SELECT tenant_id INTO v_payment_tenant
  FROM client_invoice_payments
  WHERE id = NEW.payment_id;

  IF v_payment_tenant IS NULL THEN
    RAISE EXCEPTION 'client_invoice_payments % not found', NEW.payment_id;
  END IF;

  IF NEW.tenant_id <> v_invoice_tenant OR NEW.tenant_id <> v_payment_tenant THEN
    RAISE EXCEPTION 'receipt tenant_id must match invoice and payment tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_receipt_tenant_match ON public.client_receipts;
CREATE TRIGGER trg_client_receipt_tenant_match
  BEFORE INSERT OR UPDATE OF invoice_id, payment_id, tenant_id ON public.client_receipts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_client_receipt_tenant_match();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_receipts TO authenticated;
GRANT ALL ON public.client_receipts TO service_role;

ALTER TABLE public.client_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_receipts_tenant_select ON public.client_receipts;
CREATE POLICY client_receipts_tenant_select
  ON public.client_receipts
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      current_user_role() IN (
        'super_admin'::app_role,
        'finance'::app_role,
        'hr'::app_role
      )
      OR (
        current_user_role() = 'client'::app_role
        AND EXISTS (
          SELECT 1
          FROM client_invoices ci
          WHERE ci.id = client_receipts.invoice_id
            AND ci.client_id = current_user_client_id()
        )
      )
    )
  );

DROP POLICY IF EXISTS client_receipts_finance_write ON public.client_receipts;
CREATE POLICY client_receipts_finance_write
  ON public.client_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

DROP POLICY IF EXISTS client_receipts_finance_update ON public.client_receipts;
CREATE POLICY client_receipts_finance_update
  ON public.client_receipts
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

DROP POLICY IF EXISTS client_receipts_finance_delete ON public.client_receipts;
CREATE POLICY client_receipts_finance_delete
  ON public.client_receipts
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN ('super_admin'::app_role, 'finance'::app_role)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
