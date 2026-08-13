-- Script 214: Default new sites' required_staff to 0 (explicit default over silent null).

BEGIN;

ALTER TABLE public.sites
  ALTER COLUMN required_staff SET DEFAULT 0;

COMMENT ON COLUMN public.sites.required_staff IS
  'Headcount required for duty roster staffing. Defaults to 0 for new sites; null on legacy rows means roster staffing not configured.';

COMMIT;

NOTIFY pgrst, 'reload schema';
