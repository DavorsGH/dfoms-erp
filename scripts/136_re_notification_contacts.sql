-- Script 136: Real Estate notification contacts (self-service, DB-stored).
-- - landlords.notification_phone: SMS recipient for platform_only landlord ops alerts
-- - Expand tenants UPDATE grant so Workspace Settings can persist phone/email/address
--   (Davors workspace tenants.phone / tenants.email are the Davors staff alert contacts)
-- Apply in Supabase SQL Editor (staging first, then production).

BEGIN;

ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS notification_phone text;

COMMENT ON COLUMN public.landlords.notification_phone IS
  'SMS recipient for Real Estate ops alerts when landlord_type = platform_only. Editable by Davors staff on the landlord detail page. Nullable.';

-- Script 68 granted UPDATE (name, logo_url, updated_at) only; Workspace Settings also
-- saves address/phone/email. Column grants accumulate.
GRANT UPDATE (address, phone, email) ON public.tenants TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
