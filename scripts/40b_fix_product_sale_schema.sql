-- Script 40b: Ensure income_register.product_id FK exists and reload PostgREST cache.
-- Fixes: "Could not find a relationship between 'income_register' and 'finished_products'"

BEGIN;

-- Ensure product_id column exists (idempotent with script 40)
ALTER TABLE income_register
  ADD COLUMN IF NOT EXISTS product_id UUID;

-- Add explicit FK if missing (inline REFERENCES on ADD COLUMN IF NOT EXISTS is skipped
-- when the column already existed without a constraint)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'income_register'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'product_id'
  ) THEN
    ALTER TABLE income_register
      ADD CONSTRAINT income_register_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES finished_products (id);
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
