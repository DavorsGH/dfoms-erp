-- 251: Allow facility_manager as lessee_complaints.raised_by.
-- FM portal was inserting raised_by='landlord', mislabeling FM-filed complaints.

ALTER TABLE public.lessee_complaints
  DROP CONSTRAINT IF EXISTS lessee_complaints_raised_by_check;

ALTER TABLE public.lessee_complaints
  ADD CONSTRAINT lessee_complaints_raised_by_check
  CHECK (raised_by = ANY (ARRAY['tenant'::text, 'landlord'::text, 'facility_manager'::text]));

COMMENT ON CONSTRAINT lessee_complaints_raised_by_check ON public.lessee_complaints IS
  'Filer persona: tenant (lessee portal), landlord (landlord portal), or facility_manager (FM portal).';
