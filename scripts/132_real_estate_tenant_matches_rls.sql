-- Script 132: Additive tenant_matches staff RLS for Real Estate tables
-- that received lessee-portal SELECT policies in script 131.
--
-- Convention matches scripts/60_tenant_rls_policies.sql generic loop:
--   _tenant_select / _tenant_insert / _tenant_update / _tenant_delete
--   USING / WITH CHECK (tenant_matches(tenant_id))
--
-- Does NOT modify or drop lessee_portal_select_own_* policies.
-- Postgres ORs policies per command, so:
--   - Lessee JWTs keep own-row access via portal policies
--   - Staff JWTs whose user_accounts.tenant_id matches the row's tenant_id
--     get full CRUD under normal SaaS tenant isolation
--   - Service role continues to bypass RLS (Davors admin APIs)

BEGIN;

-- ---------------------------------------------------------------------------
-- lessees
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS lessees_tenant_select ON public.lessees;
CREATE POLICY lessees_tenant_select
  ON public.lessees
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessees_tenant_insert ON public.lessees;
CREATE POLICY lessees_tenant_insert
  ON public.lessees
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessees_tenant_update ON public.lessees;
CREATE POLICY lessees_tenant_update
  ON public.lessees
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessees_tenant_delete ON public.lessees;
CREATE POLICY lessees_tenant_delete
  ON public.lessees
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

-- ---------------------------------------------------------------------------
-- leases
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS leases_tenant_select ON public.leases;
CREATE POLICY leases_tenant_select
  ON public.leases
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leases_tenant_insert ON public.leases;
CREATE POLICY leases_tenant_insert
  ON public.leases
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leases_tenant_update ON public.leases;
CREATE POLICY leases_tenant_update
  ON public.leases
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS leases_tenant_delete ON public.leases;
CREATE POLICY leases_tenant_delete
  ON public.leases
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

-- ---------------------------------------------------------------------------
-- rent_ledger
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS rent_ledger_tenant_select ON public.rent_ledger;
CREATE POLICY rent_ledger_tenant_select
  ON public.rent_ledger
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS rent_ledger_tenant_insert ON public.rent_ledger;
CREATE POLICY rent_ledger_tenant_insert
  ON public.rent_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS rent_ledger_tenant_update ON public.rent_ledger;
CREATE POLICY rent_ledger_tenant_update
  ON public.rent_ledger
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS rent_ledger_tenant_delete ON public.rent_ledger;
CREATE POLICY rent_ledger_tenant_delete
  ON public.rent_ledger
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

-- ---------------------------------------------------------------------------
-- property_units
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS property_units_tenant_select ON public.property_units;
CREATE POLICY property_units_tenant_select
  ON public.property_units
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_units_tenant_insert ON public.property_units;
CREATE POLICY property_units_tenant_insert
  ON public.property_units
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_units_tenant_update ON public.property_units;
CREATE POLICY property_units_tenant_update
  ON public.property_units
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS property_units_tenant_delete ON public.property_units;
CREATE POLICY property_units_tenant_delete
  ON public.property_units
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

-- ---------------------------------------------------------------------------
-- properties
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS properties_tenant_select ON public.properties;
CREATE POLICY properties_tenant_select
  ON public.properties
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS properties_tenant_insert ON public.properties;
CREATE POLICY properties_tenant_insert
  ON public.properties
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS properties_tenant_update ON public.properties;
CREATE POLICY properties_tenant_update
  ON public.properties
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS properties_tenant_delete ON public.properties;
CREATE POLICY properties_tenant_delete
  ON public.properties
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

-- Ensure authenticated can exercise the policies (SELECT already granted in 131).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lessees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.leases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.rent_ledger TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.property_units TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.properties TO authenticated;

COMMIT;
