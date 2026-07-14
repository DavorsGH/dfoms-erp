-- Script 42: Optional site tagging on internal_consumption
-- Client is derived from sites.client_id via site_id — not duplicated here.

BEGIN;

ALTER TABLE internal_consumption
  ADD COLUMN IF NOT EXISTS site_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'internal_consumption_site_id_fkey'
  ) THEN
    ALTER TABLE internal_consumption
      ADD CONSTRAINT internal_consumption_site_id_fkey
      FOREIGN KEY (site_id) REFERENCES sites (site_code);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
