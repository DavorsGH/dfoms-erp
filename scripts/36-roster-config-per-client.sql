-- Script 36: Per-client roster_config
-- Run in Supabase SQL editor after reviewing existing roster_config rows.
-- Migrates the current global roster settings to Central University's client_id.

BEGIN;

ALTER TABLE roster_config
  ADD COLUMN IF NOT EXISTS client_id text;

UPDATE roster_config rc
SET client_id = c.client_id
FROM clients c
WHERE rc.client_id IS NULL
  AND (
    UPPER(TRIM(c.client_id)) IN ('CL-001', 'CLI001', 'CL001')
    OR LOWER(TRIM(c.client_name)) LIKE '%central university%'
  );

UPDATE roster_config rc
SET client_id = (
  SELECT client_id
  FROM clients
  ORDER BY client_name
  LIMIT 1
)
WHERE rc.client_id IS NULL
  AND (SELECT COUNT(*) FROM clients) = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roster_config_client_id_fkey'
  ) THEN
    ALTER TABLE roster_config
      ADD CONSTRAINT roster_config_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients (client_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roster_config_client_id_unique'
  ) THEN
    ALTER TABLE roster_config
      ADD CONSTRAINT roster_config_client_id_unique UNIQUE (client_id);
  END IF;
END $$;

-- Only enforce NOT NULL once every existing row has been assigned a client.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM roster_config WHERE client_id IS NULL) THEN
    ALTER TABLE roster_config
      ALTER COLUMN client_id SET NOT NULL;
  END IF;
END $$;

COMMIT;
