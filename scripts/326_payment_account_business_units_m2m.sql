BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_account_business_units (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_account_id uuid NOT NULL REFERENCES public.payment_accounts(id) ON DELETE CASCADE,
  business_unit_id uuid NOT NULL REFERENCES public.business_units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_account_id, business_unit_id)
);

CREATE INDEX IF NOT EXISTS payment_account_business_units_tenant_business_unit_idx
  ON public.payment_account_business_units (tenant_id, business_unit_id);

INSERT INTO public.payment_account_business_units (
  tenant_id,
  payment_account_id,
  business_unit_id,
  created_at
)
SELECT
  pa.tenant_id,
  pa.id,
  pa.business_unit_id,
  now()
FROM public.payment_accounts pa
WHERE pa.business_unit_id IS NOT NULL
ON CONFLICT (payment_account_id, business_unit_id) DO NOTHING;

DROP INDEX IF EXISTS public.payment_accounts_tenant_id_business_unit_id_idx;

ALTER TABLE public.payment_accounts
  DROP CONSTRAINT IF EXISTS payment_accounts_business_unit_id_fkey;

ALTER TABLE public.payment_accounts
  DROP COLUMN IF EXISTS business_unit_id;

ALTER TABLE public.payment_account_business_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_account_business_units_super_admin_all
  ON public.payment_account_business_units;

CREATE POLICY payment_account_business_units_super_admin_all
  ON public.payment_account_business_units
  FOR ALL
  TO authenticated
  USING (public.tenant_matches(tenant_id) AND public.is_super_admin())
  WITH CHECK (public.tenant_matches(tenant_id) AND public.is_super_admin());

REVOKE ALL ON TABLE public.payment_account_business_units FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.payment_account_business_units TO authenticated;

GRANT ALL ON TABLE public.payment_account_business_units TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
