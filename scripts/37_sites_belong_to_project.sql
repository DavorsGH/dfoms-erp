-- Script 37: Sites belong to project (Client -> Project -> Site)
-- Reverses script 35's projects.site_id link. Sites gain project_id + required_staff;
-- projects gain a UUID primary key.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. projects.id UUID primary key (project_code remains unique business id)
-- ---------------------------------------------------------------------------
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE projects
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE projects
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE projects
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_id_unique'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_id_unique UNIQUE (id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_code_key'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_project_code_key UNIQUE (project_code);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Nine new Central University site rows (PRJ13–PRJ21 legacy names)
--    PRJ22 also gets a site row (10 total new sites; see audit note in report)
-- ---------------------------------------------------------------------------
INSERT INTO sites (
  site_code,
  client_id,
  site_name,
  building,
  floor_zone,
  area_room,
  cleaning_frequency,
  risk_level,
  assigned_supervisor,
  notes
)
SELECT
  v.site_code,
  'CL-001',
  v.site_name,
  v.building,
  'All Floors',
  'Full Area',
  'Daily',
  'Medium',
  NULL,
  NULL
FROM (
  VALUES
    ('SI-006', 'Faculty Blocks A', 'Faculty Blocks A'),
    ('SI-007', 'Faculty Blocks B', 'Faculty Blocks B'),
    ('SI-008', 'Faculty Blocks C', 'Faculty Blocks C'),
    ('SI-009', 'Faculty Blocks D - Science', 'Faculty Blocks D - Science'),
    ('SI-010', 'Faculty Blocks E', 'Faculty Blocks E'),
    ('SI-011', 'Faculty Blocks F', 'Faculty Blocks F'),
    ('SI-012', 'Faculty Blocks G', 'Faculty Blocks G'),
    ('SI-013', 'UPJEES Block', 'UPJEES Block'),
    ('SI-014', 'ICGC Head Office Block A', 'ICGC Head Office Block A'),
    ('SI-015', 'ICGC Head Office Block B', 'ICGC Head Office Block B')
) AS v(site_code, site_name, building)
WHERE NOT EXISTS (
  SELECT 1 FROM sites s WHERE s.site_code = v.site_code
);

-- ---------------------------------------------------------------------------
-- 3. sites.required_staff + sites.project_id
-- ---------------------------------------------------------------------------
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS required_staff integer;

ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS project_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sites_project_id_fkey'
  ) THEN
    ALTER TABLE sites
      ADD CONSTRAINT sites_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects (id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Backfill required_staff from legacy PRJ09–PRJ12 roster facility rows
-- ---------------------------------------------------------------------------
UPDATE sites s
SET required_staff = p.required_staff
FROM projects p
WHERE p.site_id = s.site_code
  AND p.required_staff IS NOT NULL;

-- Explicit fallbacks if site_id mapping already diverged
UPDATE sites SET required_staff = 6 WHERE site_code = 'SI-001' AND required_staff IS NULL;
UPDATE sites SET required_staff = 6 WHERE site_code = 'SI-002' AND required_staff IS NULL;
UPDATE sites SET required_staff = 4 WHERE site_code = 'SI-003' AND required_staff IS NULL;
UPDATE sites SET required_staff = 3 WHERE site_code = 'SI-004' AND required_staff IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Backfill sites.project_id to consolidated contract rows
-- ---------------------------------------------------------------------------
UPDATE sites s
SET project_id = p.id
FROM projects p
WHERE s.client_id = 'CL-001'
  AND p.project_code = 'PRJ01'
  AND s.project_id IS NULL;

UPDATE sites s
SET project_id = p.id
FROM projects p
WHERE s.site_code = 'SI-005'
  AND p.project_code = 'PRJ08'
  AND s.project_id IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Drop legacy projects.site_id (wrong direction)
-- ---------------------------------------------------------------------------
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_site_id_fkey;

ALTER TABLE projects
  DROP COLUMN IF EXISTS site_id;

COMMIT;

NOTIFY pgrst, 'reload schema';
