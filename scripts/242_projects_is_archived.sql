-- Script 242: Soft-deactivate contracts/projects (is_archived)
-- Matches finished_products / raw_materials archive convention.
-- Staging first. Platform-wide (all tenants).

BEGIN;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.projects.is_archived IS
  'When true, contract/project is hidden from new-assignment dropdowns but kept for history and the Contract/Project Assignments list.';

COMMIT;

NOTIFY pgrst, 'reload schema';
