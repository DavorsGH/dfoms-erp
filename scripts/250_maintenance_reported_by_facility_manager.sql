-- 250: Allow facility_manager as maintenance_requests.reported_by.
-- FM portal was inserting reported_by='staff' to satisfy the old CHECK;
-- that permanently mislabeled who created the request.

ALTER TABLE public.maintenance_requests
  DROP CONSTRAINT IF EXISTS maintenance_requests_reported_by_check;

ALTER TABLE public.maintenance_requests
  ADD CONSTRAINT maintenance_requests_reported_by_check
  CHECK (reported_by = ANY (ARRAY['staff'::text, 'tenant'::text, 'facility_manager'::text]));

COMMENT ON CONSTRAINT maintenance_requests_reported_by_check ON public.maintenance_requests IS
  'Reporter persona: staff (ERP), tenant (lessee portal), or facility_manager (FM portal).';
