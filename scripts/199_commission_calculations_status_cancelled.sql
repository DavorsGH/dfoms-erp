-- 199_commission_calculations_status_cancelled.sql
-- Extend commission_calculations.status CHECK to allow 'cancelled' (script 198 RPC).

BEGIN;

ALTER TABLE public.commission_calculations
  DROP CONSTRAINT IF EXISTS commission_calculations_status_check;

ALTER TABLE public.commission_calculations
  ADD CONSTRAINT commission_calculations_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'approved'::text,
        'paid'::text,
        'cancelled'::text
      ]
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'commission_calculations'
      AND c.conname = 'commission_calculations_status_check'
      AND pg_get_constraintdef(c.oid) LIKE '%cancelled%'
  ) THEN
    RAISE EXCEPTION 'commission_calculations_status_check missing cancelled value after migration';
  END IF;

  RAISE NOTICE 'Script 199 complete: commission_calculations.status allows cancelled.';
END $$;

COMMIT;
