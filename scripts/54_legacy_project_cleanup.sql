-- Script 54: Legacy project cleanup (PRJ03, PRJ06, PRJ23)
-- Part 1: Migrate Home Cleaning + Landscaping to service_types, delete PRJ03/PRJ06
-- Part 2: Migrate Gifty (EMP0002) payroll PRJ23 -> PRJ01, delete PRJ23

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add service categories for Income Register
-- ---------------------------------------------------------------------------
INSERT INTO service_types (name)
SELECT v.name
FROM (VALUES ('Home Cleaning'), ('Landscaping')) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM service_types st WHERE st.name = v.name
);

-- ---------------------------------------------------------------------------
-- 2. Migrate payroll snapshots from PRJ23 -> PRJ01 (label only; amounts unchanged)
-- ---------------------------------------------------------------------------
UPDATE payroll_processing
SET project_contract = 'PRJ01'
WHERE project_contract = 'PRJ23'
  AND employee_id = 'EMP0002';

UPDATE payroll_history
SET project_contract = 'PRJ01'
WHERE project_contract = 'PRJ23'
  AND employee_id = 'EMP0002';

-- ---------------------------------------------------------------------------
-- 3. Delete orphaned legacy project rows (confirmed zero other dependents)
-- ---------------------------------------------------------------------------
DELETE FROM projects
WHERE project_code IN ('PRJ03', 'PRJ06', 'PRJ23');

NOTIFY pgrst, 'reload schema';

COMMIT;
