-- Script 189: Store uploaded file content hash on bulk_import_jobs for re-upload detection.
-- Apply staging first; production after verification.

BEGIN;

ALTER TABLE public.bulk_import_jobs
  ADD COLUMN IF NOT EXISTS file_hash text;

COMMENT ON COLUMN public.bulk_import_jobs.file_hash IS
  'SHA-256 hex digest of the raw uploaded file bytes; used to detect likely re-uploads.';

CREATE INDEX IF NOT EXISTS bulk_import_jobs_reupload_lookup_idx
  ON public.bulk_import_jobs (tenant_id, import_type, file_hash, committed_at DESC)
  WHERE status = 'committed' AND file_hash IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
