BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE projects SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE projects ALTER COLUMN id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN id SET DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_id_unique'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_id_unique UNIQUE (id);
  END IF;
END $$;

INSERT INTO sites (
  site_code, client_id, site_name, building, floor_zone, area_room,
  cleaning_frequency, risk_level, assigned_supervisor, notes
)
SELECT v.site_code, 'CL-001', v.site_name, v.building,
  'All Floors', 'Full Area', 'Daily', 'Medium', NULL, NULL
FROM (VALUES
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
WHERE NOT EXISTS (SELECT 1 FROM sites s WHERE s.site_code = v.site_code);

ALTER TABLE sites ADD COLUMN IF NOT EXISTS required_staff integer;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS project_id UUID;

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

COMMIT;
