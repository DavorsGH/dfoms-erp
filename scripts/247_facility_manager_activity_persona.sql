-- 247: Allow facility_manager persona in user_activity_log
BEGIN;

ALTER TABLE public.user_activity_log
  DROP CONSTRAINT IF EXISTS user_activity_log_persona_check;

ALTER TABLE public.user_activity_log
  ADD CONSTRAINT user_activity_log_persona_check
  CHECK (persona IN ('staff', 'lessee', 'landlord', 'facility_manager'));

COMMENT ON COLUMN public.user_activity_log.persona IS
  'Portal persona: staff ERP, lessee tenant portal, landlord portal, or facility manager portal.';

COMMIT;
