BEGIN;

CREATE TABLE IF NOT EXISTS public.supplier_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE SET NULL,
  supplier_id uuid NOT NULL REFERENCES public.suppliers (id) ON DELETE RESTRICT,
  supplier_name text NOT NULL,
  contract_number text NOT NULL,
  contract_sequence integer NOT NULL,
  agreement_type text NOT NULL CHECK (agreement_type IN ('written', 'verbal')),
  document_url text,
  start_date date NOT NULL,
  end_date date NOT NULL,
  auto_renew boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
  expense_category text NOT NULL,
  sub_category text NOT NULL,
  wht_rate numeric(6, 2) NOT NULL DEFAULT 0,
  next_billing_date date,
  mid_month_reminder_enabled boolean NOT NULL DEFAULT false,
  mid_month_reminder_day integer NOT NULL DEFAULT 15
    CHECK (mid_month_reminder_day >= 1 AND mid_month_reminder_day <= 28),
  credit_balance numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_contracts_end_after_start CHECK (end_date >= start_date),
  CONSTRAINT supplier_contracts_tenant_number_unique UNIQUE (tenant_id, contract_number),
  CONSTRAINT supplier_contracts_tenant_sequence_unique UNIQUE (tenant_id, contract_sequence)
);

CREATE INDEX IF NOT EXISTS supplier_contracts_tenant_status_next_billing_idx
  ON public.supplier_contracts (tenant_id, status, next_billing_date)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS supplier_contracts_tenant_supplier_idx
  ON public.supplier_contracts (tenant_id, supplier_id);

CREATE TABLE IF NOT EXISTS public.supplier_contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.supplier_contracts (id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  previous_monthly_amount numeric(12, 2),
  new_monthly_amount numeric(12, 2) NOT NULL,
  change_reason text NOT NULL,
  document_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS supplier_contract_amendments_contract_effective_idx
  ON public.supplier_contract_amendments (contract_id, effective_date DESC);

CREATE TABLE IF NOT EXISTS public.supplier_contract_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE SET NULL,
  contract_id uuid NOT NULL REFERENCES public.supplier_contracts (id) ON DELETE CASCADE,
  service_date date NOT NULL,
  billing_month date NOT NULL,
  accounts_payable_id uuid REFERENCES public.accounts_payable (id) ON DELETE SET NULL,
  replacement_expense_id uuid REFERENCES public.expense_register (id) ON DELETE SET NULL,
  replacement_name text NOT NULL,
  deduction_amount numeric(12, 2) NOT NULL,
  amount_applied numeric(12, 2) NOT NULL DEFAULT 0,
  amount_carried_forward numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS supplier_contract_deductions_contract_idx
  ON public.supplier_contract_deductions (contract_id, service_date DESC);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_payable_supplier_contract_invoice_key
  ON public.accounts_payable (tenant_id, source_id, invoice_number)
  WHERE source_type = 'supplier_contract';

ALTER TABLE public.supplier_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_contract_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_contracts_finance_all ON public.supplier_contracts;
CREATE POLICY supplier_contracts_finance_all
  ON public.supplier_contracts
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

DROP POLICY IF EXISTS supplier_contract_amendments_finance_all ON public.supplier_contract_amendments;
CREATE POLICY supplier_contract_amendments_finance_all
  ON public.supplier_contract_amendments
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

DROP POLICY IF EXISTS supplier_contract_deductions_finance_all ON public.supplier_contract_deductions;
CREATE POLICY supplier_contract_deductions_finance_all
  ON public.supplier_contract_deductions
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND can_access_finance_income_data())
  WITH CHECK (tenant_matches(tenant_id) AND can_access_finance_income_data());

COMMIT;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'supplier_contracts'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'supplier_contract_amendments'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'supplier_contract_deductions'
ORDER BY ordinal_position;

SELECT indexname FROM pg_indexes
WHERE tablename = 'accounts_payable'
  AND indexname = 'accounts_payable_supplier_contract_invoice_key';

SELECT policyname, tablename FROM pg_policies
WHERE tablename IN (
  'supplier_contracts',
  'supplier_contract_amendments',
  'supplier_contract_deductions'
)
ORDER BY tablename, policyname;
