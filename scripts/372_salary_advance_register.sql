BEGIN;

CREATE TABLE IF NOT EXISTS public.salary_advance_register (
  advance_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE RESTRICT,
  employee_id text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  date_issued date NOT NULL,
  deduct_payroll_month date NOT NULL,
  payment_account_id uuid NOT NULL REFERENCES public.payment_accounts (id) ON DELETE RESTRICT,
  approved_by text NOT NULL,
  status text NOT NULL DEFAULT 'outstanding',
  deducted_at timestamptz,
  payroll_month_locked date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT salary_advance_register_pkey PRIMARY KEY (tenant_id, advance_id),
  CONSTRAINT salary_advance_register_amount_positive CHECK (amount > 0),
  CONSTRAINT salary_advance_register_status_check
    CHECK (status IN ('outstanding', 'deducted')),
  CONSTRAINT salary_advance_register_deduct_month_chk
    CHECK (
      deduct_payroll_month = date_trunc('month', deduct_payroll_month::timestamp)::date
    ),
  CONSTRAINT salary_advance_register_employee_fkey
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, employee_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_register_tenant_deduct_status
  ON public.salary_advance_register (tenant_id, deduct_payroll_month, status);

CREATE INDEX IF NOT EXISTS idx_salary_advance_register_tenant_employee
  ON public.salary_advance_register (tenant_id, employee_id);

CREATE INDEX IF NOT EXISTS idx_salary_advance_register_tenant_bu_issued
  ON public.salary_advance_register (tenant_id, business_unit_id, date_issued);

DROP TRIGGER IF EXISTS trg_salary_advance_register_enforce_tenant_id
  ON public.salary_advance_register;
CREATE TRIGGER trg_salary_advance_register_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.salary_advance_register
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_advance_register TO authenticated;
GRANT ALL ON public.salary_advance_register TO service_role;

ALTER TABLE public.salary_advance_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS salary_advance_register_tenant_select ON public.salary_advance_register;
CREATE POLICY salary_advance_register_tenant_select
  ON public.salary_advance_register
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS salary_advance_register_tenant_insert ON public.salary_advance_register;
CREATE POLICY salary_advance_register_tenant_insert
  ON public.salary_advance_register
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS salary_advance_register_tenant_update ON public.salary_advance_register;
CREATE POLICY salary_advance_register_tenant_update
  ON public.salary_advance_register
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS salary_advance_register_tenant_delete ON public.salary_advance_register;
CREATE POLICY salary_advance_register_tenant_delete
  ON public.salary_advance_register
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS super_admin_full_access ON public.salary_advance_register;
CREATE POLICY super_admin_full_access
  ON public.salary_advance_register
  USING (public.is_super_admin() AND public.tenant_matches(tenant_id))
  WITH CHECK (public.is_super_admin() AND public.tenant_matches(tenant_id));

ALTER TABLE public.salary_advance_register
  ALTER COLUMN business_unit_id DROP NOT NULL;

COMMIT;
