-- 209_client_quotations_product_type.sql
-- Product quotation type, product line columns, header discount, client portal RLS.

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS quotation_type text NOT NULL DEFAULT 'service'
    CHECK (quotation_type IN ('service', 'product'));

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS header_discount_amount numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (header_discount_amount >= 0);

ALTER TABLE public.client_quotation_line_items
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.finished_products(id) ON DELETE SET NULL;

ALTER TABLE public.client_quotation_line_items
  ADD COLUMN IF NOT EXISTS quantity numeric(14, 4);

ALTER TABLE public.client_quotation_line_items
  ADD COLUMN IF NOT EXISTS unit_price numeric(12, 2);

CREATE INDEX IF NOT EXISTS client_quotations_quotation_type_idx
  ON public.client_quotations (tenant_id, quotation_type);

CREATE INDEX IF NOT EXISTS client_quotation_line_items_product_id_idx
  ON public.client_quotation_line_items (product_id)
  WHERE product_id IS NOT NULL;

-- Client portal read access (non-draft quotations for linked customer only).
ALTER TABLE public.client_quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_quotations_client_portal_select ON public.client_quotations;
CREATE POLICY client_quotations_client_portal_select
  ON public.client_quotations
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() = 'client'::app_role
    AND client_id = current_user_client_id()
    AND status <> 'draft'::text
  );

ALTER TABLE public.client_quotation_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_quotation_line_items_client_portal_select
  ON public.client_quotation_line_items;
CREATE POLICY client_quotation_line_items_client_portal_select
  ON public.client_quotation_line_items
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() = 'client'::app_role
    AND EXISTS (
      SELECT 1
      FROM public.client_quotations cq
      WHERE cq.id = client_quotation_line_items.quotation_id
        AND cq.tenant_id = client_quotation_line_items.tenant_id
        AND cq.client_id = current_user_client_id()
        AND cq.status <> 'draft'::text
    )
  );

ALTER TABLE public.client_quotation_payment_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_quotation_payment_accounts_client_portal_select
  ON public.client_quotation_payment_accounts;
CREATE POLICY client_quotation_payment_accounts_client_portal_select
  ON public.client_quotation_payment_accounts
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() = 'client'::app_role
    AND EXISTS (
      SELECT 1
      FROM public.client_quotations cq
      WHERE cq.id = client_quotation_payment_accounts.quotation_id
        AND cq.tenant_id = client_quotation_payment_accounts.tenant_id
        AND cq.client_id = current_user_client_id()
        AND cq.status <> 'draft'::text
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_quotations' AND column_name = 'quotation_type'
  ) THEN
    RAISE EXCEPTION 'client_quotations.quotation_type column missing after migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_quotations' AND column_name = 'header_discount_amount'
  ) THEN
    RAISE EXCEPTION 'client_quotations.header_discount_amount column missing after migration';
  END IF;
  RAISE NOTICE 'Script 209 complete: product quotation columns and client portal RLS added.';
END $$;

COMMIT;
