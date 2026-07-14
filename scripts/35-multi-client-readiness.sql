-- Script 35: Multi-client readiness (Phase A schema links)
-- Adds income_register.client_id and projects.site_id with FK constraints,
-- then backfills existing Central University data.

BEGIN;

-- ---------------------------------------------------------------------------
-- income_register.client_id
-- ---------------------------------------------------------------------------
ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS client_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'income_register_client_id_fkey'
  ) THEN
    ALTER TABLE income_register
      ADD CONSTRAINT income_register_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients (client_id);
  END IF;
END $$;

UPDATE income_register ir
SET client_id = c.client_id
FROM clients c
WHERE ir.client_id IS NULL
  AND (
    LOWER(TRIM(ir.customer_name)) = LOWER(TRIM(c.client_name))
    OR LOWER(TRIM(ir.customer_name)) LIKE '%central university%'
      AND (
        UPPER(TRIM(c.client_id)) IN ('CL-001', 'CLI001', 'CL001')
        OR LOWER(TRIM(c.client_name)) LIKE '%central university%'
      )
  );

-- ---------------------------------------------------------------------------
-- projects.site_id
-- ---------------------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS site_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_site_id_fkey'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES sites (site_code);
  END IF;
END $$;

-- Link roster facility projects to their operational sites by name.
UPDATE projects p
SET site_id = s.site_code
FROM sites s
WHERE p.site_id IS NULL
  AND LOWER(TRIM(p.project_name)) = LOWER(TRIM(s.site_name));

-- Explicit fallbacks for known CU duty-roster facility codes.
UPDATE projects SET site_id = 'SI-001' WHERE project_code = 'PRJ09' AND site_id IS NULL;
UPDATE projects SET site_id = 'SI-003' WHERE project_code = 'PRJ10' AND site_id IS NULL;
UPDATE projects SET site_id = 'SI-004' WHERE project_code = 'PRJ11' AND site_id IS NULL;
UPDATE projects SET site_id = 'SI-002' WHERE project_code = 'PRJ12' AND site_id IS NULL;

COMMIT;
