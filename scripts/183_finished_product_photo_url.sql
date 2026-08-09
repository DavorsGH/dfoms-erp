BEGIN;

ALTER TABLE public.finished_products
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMIT;
