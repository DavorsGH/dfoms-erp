-- =============================================================================
-- script_contract_pnl_01_project_service_contract_link_staging.sql
-- Contract P&L prep (step 01): link projects (contract/site roll-ups) to
-- client service contracts via projects.service_contract_id.
--
-- Apply to STAGING first; verify; then production when Contract P&L ships.
-- Safe to re-run (IF NOT EXISTS / DROP IF EXISTS).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Nullable FK: project -> service contract (same tenant enforced below)
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS service_contract_id uuid;

COMMENT ON COLUMN public.projects.service_contract_id IS
  'Optional link to public.service_contracts for Contract P&L. NULL = company overhead / internal.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'projects_service_contract_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_service_contract_id_fkey
      FOREIGN KEY (service_contract_id)
      REFERENCES public.service_contracts (id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_tenant_service_contract_idx
  ON public.projects (tenant_id, service_contract_id)
  WHERE service_contract_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Reject cross-tenant contract links (app surfaces this message)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_projects_service_contract_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contract_tenant uuid;
BEGIN
  IF NEW.service_contract_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sc.tenant_id
  INTO v_contract_tenant
  FROM public.service_contracts sc
  WHERE sc.id = NEW.service_contract_id;

  IF v_contract_tenant IS NULL THEN
    RAISE EXCEPTION 'Service contract % not found', NEW.service_contract_id;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM v_contract_tenant THEN
    RAISE EXCEPTION 'Service contract does not belong to this tenant';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_service_contract_tenant_match
  ON public.projects;

CREATE TRIGGER trg_projects_service_contract_tenant_match
  BEFORE INSERT OR UPDATE OF service_contract_id, tenant_id
  ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_projects_service_contract_tenant_match();

-- ---------------------------------------------------------------------------
-- 3. Optional STAGING data backfill (Davors / Central University example)
--    Skip on production unless you intentionally want the same seed logic.
--    Links named campus projects to the earliest CL-001 service contract;
--    leaves internal projects (e.g. Davors Office) as NULL (overhead).
-- ---------------------------------------------------------------------------
-- WITH cu_contract AS (
--   SELECT sc.id, sc.tenant_id
--   FROM public.service_contracts sc
--   WHERE sc.client_id = 'CL-001'
--   ORDER BY sc.contract_sequence ASC
--   LIMIT 1
-- )
-- UPDATE public.projects p
-- SET service_contract_id = cu_contract.id
-- FROM cu_contract
-- WHERE p.tenant_id = cu_contract.tenant_id
--   AND p.service_contract_id IS NULL
--   AND p.project_name IN (
--     'Trinity Hall',
--     'Basement',
--     'CU Students'' Girls Hostel',
--     'Students Centre [Plaza]'
--   );

COMMIT;

NOTIFY pgrst, 'reload schema';
