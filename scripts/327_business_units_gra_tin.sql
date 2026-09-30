BEGIN;

ALTER TABLE public.business_units ADD COLUMN IF NOT EXISTS gra_tin text;

NOTIFY pgrst, 'reload schema';

COMMIT;
