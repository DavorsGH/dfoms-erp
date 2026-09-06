-- 287_client_quotations_assigned_sales_rep_id.sql
-- Nullable ownership field for sales-rep dashboard scoping (matches employees.employee_id text).

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS assigned_sales_rep_id text;

COMMENT ON COLUMN public.client_quotations.assigned_sales_rep_id IS
  'Employee ID (employees.employee_id) of the sales rep assigned to this quotation.';

CREATE INDEX IF NOT EXISTS client_quotations_assigned_sales_rep_id_idx
  ON public.client_quotations (assigned_sales_rep_id)
  WHERE assigned_sales_rep_id IS NOT NULL AND btrim(assigned_sales_rep_id) <> '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'client_quotations'
      AND column_name = 'assigned_sales_rep_id'
  ) THEN
    RAISE EXCEPTION 'client_quotations.assigned_sales_rep_id column missing after migration';
  END IF;
  RAISE NOTICE 'Script 287 complete: client_quotations.assigned_sales_rep_id added.';
END $$;
