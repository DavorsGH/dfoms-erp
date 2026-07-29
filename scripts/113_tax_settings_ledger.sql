-- Script 113: Tax Settings / Ledger foundation.
-- Definition only. Do NOT apply to staging or production until explicitly approved.
--
-- Creates:
--   tax_settings          — per-tenant VAT registration, service/goods defaults, GRA due dates
--   tax_rate_catalog      — WHT and output-tax dropdown rates; tenant_id NULL = system defaults
--   tax_ledger_entries    — transactional tax journal (output/input/WHT/settlement)
-- Thin tax columns on income_register, expense_register, accounts_payable.
--
-- Locked decisions:
--   1. Services use the bundled VAT/NHIL/GETFund/COVID tax_component = 'vat_bundle' at 20%
--   2. Product-sale goods use Ghana VAT Flat Rate Scheme tax_component = 'vfrs' at 3%
--   3. income_register.entry_type identifies goods vs services; output_tax_component records
--      the actual output-tax treatment used on the row
--   4. manual_financial_entries.prepayments_wht_receivable / withholding_tax_payable /
--      vat_payable are deprecated for new logic — columns NOT dropped
--
-- Defaults: services vat_bundle 20%, goods VFRS 3%, WHT 7.5%.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. tax_settings (one row per tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  vat_registered boolean NOT NULL DEFAULT true,
  gra_tin text,
  default_vat_bundle_rate numeric(5, 2) NOT NULL DEFAULT 20.00,
  default_vfrs_rate numeric(5, 2) NOT NULL DEFAULT 3.00,
  default_wht_rate numeric(5, 2) NOT NULL DEFAULT 7.50,
  vat_return_period text NOT NULL DEFAULT 'monthly',
  vat_return_due_day integer,
  wht_return_due_day integer,
  next_vat_due_date date,
  next_wht_due_date date,
  reminder_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_settings_vat_return_period_check
    CHECK (vat_return_period IN ('monthly', 'quarterly')),
  CONSTRAINT tax_settings_vat_return_due_day_check
    CHECK (vat_return_due_day IS NULL OR (vat_return_due_day >= 1 AND vat_return_due_day <= 31)),
  CONSTRAINT tax_settings_wht_return_due_day_check
    CHECK (wht_return_due_day IS NULL OR (wht_return_due_day >= 1 AND wht_return_due_day <= 31)),
  CONSTRAINT tax_settings_default_vat_bundle_rate_nonneg
    CHECK (default_vat_bundle_rate >= 0),
  CONSTRAINT tax_settings_default_vfrs_rate_nonneg
    CHECK (default_vfrs_rate >= 0),
  CONSTRAINT tax_settings_default_wht_rate_nonneg
    CHECK (default_wht_rate >= 0)
);

COMMENT ON TABLE public.tax_settings IS
  'Per-tenant Tax Settings: VAT registration, service vat_bundle, goods VFRS and WHT defaults, GRA due dates and reminders.';

COMMENT ON COLUMN public.tax_settings.default_vat_bundle_rate IS
  'Bundled VAT/NHIL/GETFund/COVID rate (%) matching client_invoices.vat_nhil_getfund_rate (default 20). '
  'Applies to service income in v1.';

COMMENT ON COLUMN public.tax_settings.default_vfrs_rate IS
  'Ghana VAT Flat Rate Scheme rate (%) for product-sale goods (default 3). Separate from the service vat_bundle.';

COMMENT ON COLUMN public.tax_settings.default_wht_rate IS
  'Default WHT rate (%) matching client_invoices.wht_rate (default 7.5).';

COMMENT ON COLUMN public.tax_settings.gra_tin IS
  'GRA TIN for tax filing. Distinct from billing_settings.business_tax_id (suite billing).';

DROP TRIGGER IF EXISTS trg_tax_settings_enforce_tenant_id ON public.tax_settings;
CREATE TRIGGER trg_tax_settings_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.tax_settings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_settings_tenant_all ON public.tax_settings;
CREATE POLICY tax_settings_tenant_all
  ON public.tax_settings
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_settings_super_admin_full_access ON public.tax_settings;
CREATE POLICY tax_settings_super_admin_full_access
  ON public.tax_settings
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_settings TO service_role;

-- ---------------------------------------------------------------------------
-- 2. tax_rate_catalog (system defaults + optional tenant overrides)
-- ---------------------------------------------------------------------------
-- NOTE: No enforce_row_tenant_id() here — system seeds require tenant_id IS NULL,
-- and that trigger rejects/fills NULL tenant_id.
CREATE TABLE IF NOT EXISTS public.tax_rate_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  tax_kind text NOT NULL,
  code text NOT NULL,
  label text NOT NULL,
  rate_pct numeric(5, 2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rate_catalog_tax_kind_check
    CHECK (tax_kind IN ('wht', 'vat_bundle', 'vfrs')),
  CONSTRAINT tax_rate_catalog_rate_pct_nonneg
    CHECK (rate_pct >= 0)
);

COMMENT ON TABLE public.tax_rate_catalog IS
  'Dropdown tax rates. tenant_id NULL = system defaults; non-null = tenant overrides. '
  'vat_bundle applies to services; VFRS applies to product-sale goods.';

COMMENT ON COLUMN public.tax_rate_catalog.tenant_id IS
  'NULL for shared system defaults; otherwise tenant-specific override/addition.';

CREATE UNIQUE INDEX IF NOT EXISTS tax_rate_catalog_system_code_uidx
  ON public.tax_rate_catalog (code)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tax_rate_catalog_tenant_code_uidx
  ON public.tax_rate_catalog (tenant_id, code)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tax_rate_catalog_tenant_kind_idx
  ON public.tax_rate_catalog (tenant_id, tax_kind, is_active);

ALTER TABLE public.tax_rate_catalog ENABLE ROW LEVEL SECURITY;

-- Read: own tenant rows OR system defaults
DROP POLICY IF EXISTS tax_rate_catalog_tenant_select ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_tenant_select
  ON public.tax_rate_catalog
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id) OR tenant_id IS NULL);

-- Write: tenant-owned rows only (system seeds are migration/service_role)
DROP POLICY IF EXISTS tax_rate_catalog_tenant_insert ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_tenant_insert
  ON public.tax_rate_catalog
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_rate_catalog_tenant_update ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_tenant_update
  ON public.tax_rate_catalog
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_rate_catalog_tenant_delete ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_tenant_delete
  ON public.tax_rate_catalog
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_rate_catalog_super_admin_full_access ON public.tax_rate_catalog;
CREATE POLICY tax_rate_catalog_super_admin_full_access
  ON public.tax_rate_catalog
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rate_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rate_catalog TO service_role;

-- Seed Ghana v1 system defaults. Re-running converges the system rows to these values.
INSERT INTO public.tax_rate_catalog (
  tenant_id, tax_kind, code, label, rate_pct, is_active, sort_order
)
VALUES
  (NULL, 'wht', 'WHT_5', 'WHT 5%', 5.00, true, 10),
  (NULL, 'wht', 'WHT_7_5', 'WHT 7.5%', 7.50, true, 20),
  (NULL, 'wht', 'WHT_15', 'WHT 15%', 15.00, true, 30),
  (NULL, 'vat_bundle', 'VAT_BUNDLE_SERVICES_20', 'Services VAT/NHIL/GETFund/COVID 20%', 20.00, true, 40),
  (NULL, 'vfrs', 'VFRS_GOODS_3', 'Goods VFRS 3%', 3.00, true, 50)
ON CONFLICT (code) WHERE tenant_id IS NULL
DO UPDATE SET
  tax_kind = EXCLUDED.tax_kind,
  label = EXCLUDED.label,
  rate_pct = EXCLUDED.rate_pct,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. tax_ledger_entries (transactional tax journal)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tax_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  period_month date NOT NULL,
  direction text NOT NULL,
  tax_component text NOT NULL,
  rate_pct numeric(5, 2),
  taxable_base numeric(12, 2) NOT NULL DEFAULT 0,
  tax_amount numeric(12, 2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  source_type text NOT NULL,
  source_id uuid,
  counterparty_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_ledger_entries_direction_check
    CHECK (direction IN ('output', 'input', 'wht_receivable', 'wht_payable', 'settlement')),
  CONSTRAINT tax_ledger_entries_tax_component_check
    CHECK (tax_component IN ('vat_bundle', 'vfrs', 'wht')),
  CONSTRAINT tax_ledger_entries_status_check
    CHECK (status IN ('open', 'filed', 'paid', 'reversed')),
  CONSTRAINT tax_ledger_entries_source_type_check
    CHECK (source_type IN (
      'income_register',
      'client_invoice',
      'expense_register',
      'accounts_payable',
      'product_sale',
      'manual',
      'settlement'
    )),
  CONSTRAINT tax_ledger_entries_period_month_is_month_start
    CHECK (period_month = date_trunc('month', period_month::timestamp)::date)
);

COMMENT ON TABLE public.tax_ledger_entries IS
  'Transactional tax ledger feeding Balance Sheet VAT/WHT balances and GRA period views. '
  'Services use vat_bundle; product-sale goods use VFRS.';

COMMENT ON COLUMN public.tax_ledger_entries.direction IS
  'output = output vat_bundle/VFRS liability; input = input VAT credit; wht_receivable = client-withheld; '
  'wht_payable = supplier-withheld; settlement = GRA remittance / clearance.';

COMMENT ON COLUMN public.tax_ledger_entries.tax_component IS
  'vat_bundle = service VAT/NHIL/GETFund/COVID bundle; vfrs = goods VAT Flat Rate Scheme; wht = withholding tax.';

COMMENT ON COLUMN public.tax_ledger_entries.period_month IS
  'Month bucket as first-of-month date for GRA period aggregation.';

CREATE INDEX IF NOT EXISTS tax_ledger_entries_tenant_period_idx
  ON public.tax_ledger_entries (tenant_id, period_month);

CREATE INDEX IF NOT EXISTS tax_ledger_entries_tenant_source_idx
  ON public.tax_ledger_entries (tenant_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS tax_ledger_entries_tenant_direction_status_idx
  ON public.tax_ledger_entries (tenant_id, direction, status);

DROP TRIGGER IF EXISTS trg_tax_ledger_entries_enforce_tenant_id ON public.tax_ledger_entries;
CREATE TRIGGER trg_tax_ledger_entries_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.tax_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.tax_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_ledger_entries_tenant_select ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_tenant_select
  ON public.tax_ledger_entries
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_ledger_entries_tenant_insert ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_tenant_insert
  ON public.tax_ledger_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_ledger_entries_tenant_update ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_tenant_update
  ON public.tax_ledger_entries
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_ledger_entries_tenant_delete ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_tenant_delete
  ON public.tax_ledger_entries
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS tax_ledger_entries_super_admin_full_access ON public.tax_ledger_entries;
CREATE POLICY tax_ledger_entries_super_admin_full_access
  ON public.tax_ledger_entries
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_ledger_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_ledger_entries TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Thin tax columns on source registers
-- ---------------------------------------------------------------------------

-- income_register.entry_type already distinguishes service from product_sale.
-- output_tax_component persists the treatment actually used: vat_bundle or vfrs.
ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS net_of_tax_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS output_vat_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS output_tax_component text
    CONSTRAINT income_register_output_tax_component_check
    CHECK (
      output_tax_component IS NULL
      OR (entry_type = 'service' AND output_tax_component = 'vat_bundle')
      OR (entry_type = 'product_sale' AND output_tax_component = 'vfrs')
    ),
  ADD COLUMN IF NOT EXISTS wht_rate numeric(5, 2),
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.income_register.net_of_tax_amount IS
  'Revenue base for P&L excluding output vat_bundle or VFRS. Prefer over amount once populated.';

COMMENT ON COLUMN public.income_register.output_vat_amount IS
  'Output tax amount on this income row: service vat_bundle or goods VFRS.';

COMMENT ON COLUMN public.income_register.output_tax_component IS
  'Actual output-tax treatment: vat_bundle for services or vfrs for product-sale goods; NULL when no output tax applies.';

COMMENT ON COLUMN public.income_register.wht_amount IS
  'Client-withheld WHT (informational / receivable); not deducted from invoice total.';

COMMENT ON COLUMN public.income_register.tax_inclusive IS
  'When true, amount is treated as customer invoice total including output VAT where applicable.';

-- expense_register: input VAT + supplier WHT payable
ALTER TABLE public.expense_register
  ADD COLUMN IF NOT EXISTS net_of_tax_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS input_vat_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS wht_rate numeric(5, 2),
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS gross_before_wht numeric(12, 2);

COMMENT ON COLUMN public.expense_register.net_of_tax_amount IS
  'Expense base for P&L (ex input vat_bundle).';

COMMENT ON COLUMN public.expense_register.input_vat_amount IS
  'Bundled VAT/NHIL/GETFund/COVID input tax credit on this expense.';

COMMENT ON COLUMN public.expense_register.wht_amount IS
  'WHT withheld from supplier; cash/amount should be net after WHT when withheld.';

COMMENT ON COLUMN public.expense_register.gross_before_wht IS
  'Supplier invoice gross before WHT withholding (optional).';

-- accounts_payable: same thin tax shape as expense_register
ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS net_of_tax_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS input_vat_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS wht_rate numeric(5, 2),
  ADD COLUMN IF NOT EXISTS wht_amount numeric(12, 2),
  ADD COLUMN IF NOT EXISTS gross_before_wht numeric(12, 2);

COMMENT ON COLUMN public.accounts_payable.net_of_tax_amount IS
  'AP base ex input vat_bundle.';

COMMENT ON COLUMN public.accounts_payable.input_vat_amount IS
  'Bundled VAT/NHIL/GETFund/COVID input tax on this AP row.';

COMMENT ON COLUMN public.accounts_payable.wht_amount IS
  'WHT withheld from supplier; AP amount should be net after WHT when withheld.';

COMMENT ON COLUMN public.accounts_payable.gross_before_wht IS
  'Supplier invoice gross before WHT withholding (optional).';

-- ---------------------------------------------------------------------------
-- 5. Deprecate manual_financial_entries tax placeholders (do NOT drop)
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.manual_financial_entries.prepayments_wht_receivable IS
  'DEPRECATED for new logic — prefer tax_ledger_entries direction=wht_receivable. Column retained for bridge/history.';

COMMENT ON COLUMN public.manual_financial_entries.withholding_tax_payable IS
  'DEPRECATED for new logic — prefer tax_ledger_entries direction=wht_payable. Column retained for bridge/history.';

COMMENT ON COLUMN public.manual_financial_entries.vat_payable IS
  'DEPRECATED for new logic — prefer tax_ledger_entries vat_bundle/VFRS output tax entries. Column retained for bridge/history.';

NOTIFY pgrst, 'reload schema';

COMMIT;
