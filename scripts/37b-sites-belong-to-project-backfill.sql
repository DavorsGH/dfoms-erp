BEGIN;

UPDATE sites s
SET required_staff = p.required_staff
FROM projects p
WHERE p.site_id = s.site_code AND p.required_staff IS NOT NULL;

UPDATE sites SET required_staff = 6 WHERE site_code = 'SI-001' AND required_staff IS NULL;
UPDATE sites SET required_staff = 6 WHERE site_code = 'SI-002' AND required_staff IS NULL;
UPDATE sites SET required_staff = 4 WHERE site_code = 'SI-003' AND required_staff IS NULL;
UPDATE sites SET required_staff = 3 WHERE site_code = 'SI-004' AND required_staff IS NULL;

UPDATE sites s
SET project_id = p.id
FROM projects p
WHERE s.client_id = 'CL-001' AND p.project_code = 'PRJ01' AND s.project_id IS NULL;

UPDATE sites s
SET project_id = p.id
FROM projects p
WHERE s.site_code = 'SI-005' AND p.project_code = 'PRJ08' AND s.project_id IS NULL;

ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_site_id_fkey;
ALTER TABLE projects DROP COLUMN IF EXISTS site_id;

COMMIT;
NOTIFY pgrst, 'reload schema';
