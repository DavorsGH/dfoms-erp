-- Script 291: Staff welfare fund ledger (accruals, disbursements, adjustments).
-- Definition only. Do NOT apply to staging or production until explicitly approved.
--
-- Prerequisite: employees composite PK (tenant_id, employee_id); business_units;
--   user_has_business_unit_access() from BU Phase 2+.
--
-- Accrual rows (entry_type = accrual) are posted on payroll lock from welfare_deduction
-- totals. Disbursement rows reduce the open fund balance and link to expense_register
-- via expense_receipt_no. Balance Sheet "Staff Welfare Payable" reads open accruals
-- minus unsettled disbursements (app wiring later).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. staff_welfare_fund_ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_welfare_fund_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  period_month date,
  entry_type text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  status text NOT NULL DEFAULT 'open',
  source_type text NOT NULL,
  source_id text,
  employee_id text,
  counterparty_name text,
  notes text,
  paid_at timestamptz,
  expense_receipt_no text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_welfare_fund_ledger_entry_type_check
    CHECK (entry_type IN ('accrual', 'disbursement', 'adjustment')),
  CONSTRAINT staff_welfare_fund_ledger_status_check
    CHECK (status IN ('open', 'settled', 'reversed')),
  CONSTRAINT staff_welfare_fund_ledger_source_type_check
    CHECK (source_type IN ('payroll_period', 'manual', 'claim')),
  CONSTRAINT staff_welfare_fund_ledger_amount_positive
    CHECK (amount > 0),
  CONSTRAINT staff_welfare_fund_ledger_period_month_is_month_start
    CHECK (
      period_month IS NULL
      OR period_month = date_trunc('month', period_month::timestamp)::date
    ),
  CONSTRAINT staff_welfare_fund_ledger_accrual_period_month_chk
    CHECK (
      entry_type <> 'accrual'
      OR period_month IS NOT NULL
    ),
  CONSTRAINT staff_welfare_fund_ledger_employee_fkey
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, employee_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.staff_welfare_fund_ledger IS
  'Staff welfare fund: payroll accruals (liability buildup), disbursements (payouts), '
  'and manual adjustments. BU-scoped via business_unit_id. Fund balance = open accruals '
  '− open disbursements (app aggregation).';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.business_unit_id IS
  'Business unit for this ledger row; NULL = workspace/legacy default (tenants with no BUs).';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.period_month IS
  'First-of-month bucket for payroll accruals (entry_type = accrual). NULL for disbursements/adjustments.';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.entry_type IS
  'accrual = welfare withheld on payroll lock; disbursement = fund payout; adjustment = manual correction.';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.source_type IS
  'payroll_period = auto-posted from payroll lock; manual = user-entered; claim = employee welfare claim.';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.source_id IS
  'Opaque source key (e.g. encoded payroll month UUID for payroll_period accruals).';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.employee_id IS
  'Set on disbursements targeting a specific employee; NULL for period-aggregate accruals.';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.expense_receipt_no IS
  'Links disbursement cash posting in expense_register (e.g. Staff Welfare Disbursement receipt).';

COMMENT ON COLUMN public.staff_welfare_fund_ledger.paid_at IS
  'When the disbursement was paid / liability was settled (nullable until settled).';

CREATE INDEX IF NOT EXISTS idx_staff_welfare_fund_ledger_tenant_bu_status
  ON public.staff_welfare_fund_ledger (tenant_id, business_unit_id, status);

DROP TRIGGER IF EXISTS trg_staff_welfare_fund_ledger_enforce_tenant_id
  ON public.staff_welfare_fund_ledger;
CREATE TRIGGER trg_staff_welfare_fund_ledger_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.staff_welfare_fund_ledger
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.staff_welfare_fund_ledger ENABLE ROW LEVEL SECURITY;

-- RLS: business-unit access (Tier A/B/C/D pattern; requires user_has_business_unit_access()).
DROP POLICY IF EXISTS staff_welfare_fund_ledger_tenant_select
  ON public.staff_welfare_fund_ledger;
CREATE POLICY staff_welfare_fund_ledger_tenant_select
  ON public.staff_welfare_fund_ledger
  FOR SELECT
  TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS staff_welfare_fund_ledger_tenant_insert
  ON public.staff_welfare_fund_ledger;
CREATE POLICY staff_welfare_fund_ledger_tenant_insert
  ON public.staff_welfare_fund_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS staff_welfare_fund_ledger_tenant_update
  ON public.staff_welfare_fund_ledger;
CREATE POLICY staff_welfare_fund_ledger_tenant_update
  ON public.staff_welfare_fund_ledger
  FOR UPDATE
  TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS staff_welfare_fund_ledger_tenant_delete
  ON public.staff_welfare_fund_ledger;
CREATE POLICY staff_welfare_fund_ledger_tenant_delete
  ON public.staff_welfare_fund_ledger
  FOR DELETE
  TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

DROP POLICY IF EXISTS staff_welfare_fund_ledger_super_admin_full_access
  ON public.staff_welfare_fund_ledger;
CREATE POLICY staff_welfare_fund_ledger_super_admin_full_access
  ON public.staff_welfare_fund_ledger
  FOR ALL
  TO authenticated
  USING (
    public.is_super_admin()
    AND public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  )
  WITH CHECK (
    public.is_super_admin()
    AND public.tenant_matches(tenant_id)
    AND public.user_has_business_unit_access(business_unit_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_welfare_fund_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_welfare_fund_ledger TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
