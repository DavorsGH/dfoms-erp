-- =============================================================================
-- 227_service_contracts.sql
-- Service contracts (recurring billing source for client invoices).
-- Apply to staging first, verify with SELECT, then production.
-- Safe to re-run.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.service_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  contract_number text NOT NULL,
  contract_sequence integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  auto_renew boolean NOT NULL DEFAULT false,
  billing_frequency text NOT NULL DEFAULT 'monthly'
    CHECK (billing_frequency IN ('monthly', 'quarterly', 'annually')),
  next_billing_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  tax_basis text NOT NULL DEFAULT 'service_only'
    CHECK (tax_basis IN ('service_only', 'total_cost')),
  vat_nhil_getfund_rate numeric(6, 2) NOT NULL DEFAULT 20,
  wht_rate numeric(6, 2) NOT NULL DEFAULT 7.5,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  tax_due numeric(12, 2) NOT NULL DEFAULT 0,
  wht_amount numeric(12, 2) NOT NULL DEFAULT 0,
  total_amount_due numeric(12, 2) NOT NULL DEFAULT 0,
  document_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_contracts_tenant_client_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.customers (tenant_id, client_id)
    ON DELETE RESTRICT,
  CONSTRAINT service_contracts_end_after_start_check
    CHECK (end_date >= start_date),
  CONSTRAINT service_contracts_tenant_number_unique
    UNIQUE (tenant_id, contract_number),
  CONSTRAINT service_contracts_tenant_sequence_unique
    UNIQUE (tenant_id, contract_sequence)
);

COMMENT ON TABLE public.service_contracts IS
  'Recurring service contracts; active contracts generate draft client invoices on next_billing_date.';

CREATE INDEX IF NOT EXISTS service_contracts_tenant_status_next_billing_idx
  ON public.service_contracts (tenant_id, status, next_billing_date)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS service_contracts_tenant_client_idx
  ON public.service_contracts (tenant_id, client_id);

CREATE TABLE IF NOT EXISTS public.service_contract_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.service_contracts (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  category_label text,
  description text NOT NULL,
  labour_amount numeric(12, 2) NOT NULL DEFAULT 0,
  material_amount numeric(12, 2) NOT NULL DEFAULT 0,
  discount_amount numeric(12, 2) NOT NULL DEFAULT 0,
  taxed boolean NOT NULL DEFAULT true,
  total_cost numeric(12, 2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS service_contract_line_items_contract_idx
  ON public.service_contract_line_items (contract_id, sort_order);

ALTER TABLE public.client_invoices
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.service_contracts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_invoices_contract_id_idx
  ON public.client_invoices (contract_id)
  WHERE contract_id IS NOT NULL;

-- RLS: finance section roles via can_access_finance_income_data()
ALTER TABLE public.service_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_contract_line_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_contracts_finance_all ON public.service_contracts;
CREATE POLICY service_contracts_finance_all
  ON public.service_contracts
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

DROP POLICY IF EXISTS service_contract_line_items_finance_all ON public.service_contract_line_items;
CREATE POLICY service_contract_line_items_finance_all
  ON public.service_contract_line_items
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

COMMIT;

-- Verification (staging):
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'service_contracts' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'client_invoices' AND column_name = 'contract_id';
