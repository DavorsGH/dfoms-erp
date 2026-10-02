BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_leave_balances'
      AND column_name = 'days_remaining'
      AND is_generated = 'NEVER'
  ) THEN
    ALTER TABLE public.employee_leave_balances DROP COLUMN days_remaining;

    ALTER TABLE public.employee_leave_balances
      ADD COLUMN days_remaining numeric(8,2) GENERATED ALWAYS AS (entitled_days - days_used) STORED;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
