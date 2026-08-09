BEGIN;

ALTER TABLE public.bulk_import_jobs
  DROP CONSTRAINT IF EXISTS bulk_import_jobs_import_type_check;

ALTER TABLE public.bulk_import_jobs
  ADD CONSTRAINT bulk_import_jobs_import_type_check
  CHECK (import_type IN ('product', 'service', 'employee'));

COMMIT;

NOTIFY pgrst, 'reload schema';
