BEGIN;

ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_units_tenant_select ON public.business_units;
CREATE POLICY business_units_tenant_select
  ON public.business_units
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS business_units_tenant_insert ON public.business_units;
CREATE POLICY business_units_tenant_insert
  ON public.business_units
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.is_super_admin()
  );

DROP POLICY IF EXISTS business_units_tenant_update ON public.business_units;
CREATE POLICY business_units_tenant_update
  ON public.business_units
  FOR UPDATE
  TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.is_super_admin()
  )
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.is_super_admin()
  );

DROP POLICY IF EXISTS business_units_tenant_delete ON public.business_units;
CREATE POLICY business_units_tenant_delete
  ON public.business_units
  FOR DELETE
  TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.is_super_admin()
  );

REVOKE ALL ON TABLE public.business_units FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_units TO authenticated;
GRANT ALL ON TABLE public.business_units TO service_role;

DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.intercompany_transactions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.intercompany_transactions ENABLE ROW LEVEL SECURITY';

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'intercompany_transactions'
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.intercompany_transactions',
        v_policy.policyname
      );
    END LOOP;

    EXECUTE 'REVOKE ALL ON TABLE public.intercompany_transactions FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.intercompany_transactions FROM authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.intercompany_transactions TO service_role';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
