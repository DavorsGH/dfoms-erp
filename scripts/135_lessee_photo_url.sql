-- Script 135: Lessee (tenant person) profile photo URL.
-- Apply in Supabase SQL Editor (staging first, then production).

BEGIN;

ALTER TABLE public.lessees
  ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN public.lessees.photo_url IS
  'Public URL of the lessee profile photo (single image; not property photos).';

COMMIT;
