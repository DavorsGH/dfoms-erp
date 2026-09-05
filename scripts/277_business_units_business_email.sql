-- 277_business_units_business_email.sql
-- Optional per-business-unit contact email for documents and Reply-To.

BEGIN;

ALTER TABLE public.business_units
  ADD COLUMN IF NOT EXISTS business_email text;

COMMENT ON COLUMN public.business_units.business_email IS
  'Optional contact email for this business unit (documents + transactional Reply-To).';

COMMIT;
