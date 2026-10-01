BEGIN;

CREATE TABLE IF NOT EXISTS public.statutory_gra_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE CASCADE,
  period_month date NOT NULL,
  reconciliation_kind text NOT NULL,
  gra_portal_amount numeric(14, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statutory_gra_reconciliation_kind_check
    CHECK (reconciliation_kind IN ('vat', 'wht', 'paye'))
);

ALTER TABLE public.statutory_gra_reconciliation
  DROP CONSTRAINT IF EXISTS statutory_gra_reconciliation_tenant_bu_period_kind_key;

ALTER TABLE public.statutory_gra_reconciliation
  ADD CONSTRAINT statutory_gra_reconciliation_tenant_bu_period_kind_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, business_unit_id, period_month, reconciliation_kind);

DROP TRIGGER IF EXISTS trg_statutory_gra_reconciliation_enforce_tenant_id
  ON public.statutory_gra_reconciliation;
CREATE TRIGGER trg_statutory_gra_reconciliation_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.statutory_gra_reconciliation
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.statutory_gra_reconciliation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_gra_reconciliation_tenant_all
  ON public.statutory_gra_reconciliation;
CREATE POLICY statutory_gra_reconciliation_tenant_all
  ON public.statutory_gra_reconciliation
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS statutory_gra_reconciliation_super_admin_full_access
  ON public.statutory_gra_reconciliation;
CREATE POLICY statutory_gra_reconciliation_super_admin_full_access
  ON public.statutory_gra_reconciliation
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_gra_reconciliation TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_gra_reconciliation TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
