BEGIN;

ALTER TABLE public.bulk_import_rows
  DROP CONSTRAINT IF EXISTS bulk_import_rows_status_check;

ALTER TABLE public.bulk_import_rows
  ADD CONSTRAINT bulk_import_rows_status_check
  CHECK (status IN ('pending', 'valid', 'error', 'duplicate', 'committed'));

COMMIT;

NOTIFY pgrst, 'reload schema';
