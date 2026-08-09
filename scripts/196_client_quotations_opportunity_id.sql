-- 196_client_quotations_opportunity_id.sql
-- Optional link from client quotations to sales pipeline opportunities.

BEGIN;

ALTER TABLE client_quotations
  ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES sales_opportunities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_quotations_opportunity_id_idx
  ON client_quotations (opportunity_id)
  WHERE opportunity_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_quotations' AND column_name = 'opportunity_id'
  ) THEN
    RAISE EXCEPTION 'client_quotations.opportunity_id column missing after migration';
  END IF;
  RAISE NOTICE 'Script 196 complete: client_quotations.opportunity_id added.';
END $$;

COMMIT;
