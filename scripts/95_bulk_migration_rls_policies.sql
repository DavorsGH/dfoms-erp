BEGIN;

DROP POLICY IF EXISTS service_catalog_tenant_select ON public.service_catalog;
CREATE POLICY service_catalog_tenant_select
  ON public.service_catalog
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS service_catalog_tenant_insert ON public.service_catalog;
CREATE POLICY service_catalog_tenant_insert
  ON public.service_catalog
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS service_catalog_tenant_update ON public.service_catalog;
CREATE POLICY service_catalog_tenant_update
  ON public.service_catalog
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS service_catalog_tenant_delete ON public.service_catalog;
CREATE POLICY service_catalog_tenant_delete
  ON public.service_catalog
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

ALTER TABLE public.service_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_import_jobs_tenant_select ON public.bulk_import_jobs;
CREATE POLICY bulk_import_jobs_tenant_select
  ON public.bulk_import_jobs
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS bulk_import_jobs_tenant_insert ON public.bulk_import_jobs;
CREATE POLICY bulk_import_jobs_tenant_insert
  ON public.bulk_import_jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS bulk_import_jobs_tenant_update ON public.bulk_import_jobs;
CREATE POLICY bulk_import_jobs_tenant_update
  ON public.bulk_import_jobs
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

DROP POLICY IF EXISTS bulk_import_jobs_tenant_delete ON public.bulk_import_jobs;
CREATE POLICY bulk_import_jobs_tenant_delete
  ON public.bulk_import_jobs
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'));

ALTER TABLE public.bulk_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_import_rows_tenant_select ON public.bulk_import_rows;
CREATE POLICY bulk_import_rows_tenant_select
  ON public.bulk_import_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bulk_import_jobs j
      WHERE j.id = bulk_import_rows.job_id
        AND tenant_matches(j.tenant_id)
        AND tenant_has_feature(j.tenant_id, 'crm_core')
    )
  );

DROP POLICY IF EXISTS bulk_import_rows_tenant_insert ON public.bulk_import_rows;
CREATE POLICY bulk_import_rows_tenant_insert
  ON public.bulk_import_rows
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.bulk_import_jobs j
      WHERE j.id = bulk_import_rows.job_id
        AND tenant_matches(j.tenant_id)
        AND tenant_has_feature(j.tenant_id, 'crm_core')
    )
  );

DROP POLICY IF EXISTS bulk_import_rows_tenant_update ON public.bulk_import_rows;
CREATE POLICY bulk_import_rows_tenant_update
  ON public.bulk_import_rows
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bulk_import_jobs j
      WHERE j.id = bulk_import_rows.job_id
        AND tenant_matches(j.tenant_id)
        AND tenant_has_feature(j.tenant_id, 'crm_core')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.bulk_import_jobs j
      WHERE j.id = bulk_import_rows.job_id
        AND tenant_matches(j.tenant_id)
        AND tenant_has_feature(j.tenant_id, 'crm_core')
    )
  );

DROP POLICY IF EXISTS bulk_import_rows_tenant_delete ON public.bulk_import_rows;
CREATE POLICY bulk_import_rows_tenant_delete
  ON public.bulk_import_rows
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bulk_import_jobs j
      WHERE j.id = bulk_import_rows.job_id
        AND tenant_matches(j.tenant_id)
        AND tenant_has_feature(j.tenant_id, 'crm_core')
    )
  );

ALTER TABLE public.bulk_import_rows ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
