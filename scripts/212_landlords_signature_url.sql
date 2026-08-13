-- Landlord Portal self-service signature for platform_only landlords (Real Estate PDFs).
-- davors_managed landlords use Davors tenants.signature_url instead.

ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS signature_author_name text,
  ADD COLUMN IF NOT EXISTS signature_author_title text;

COMMENT ON COLUMN public.landlords.signature_url IS
  'platform_only landlord authorized signature for Real Estate PDFs; uploaded via Landlord Portal Workspace Settings.';

COMMENT ON COLUMN public.landlords.signature_author_name IS
  'Printed name shown on Real Estate PDF signature blocks (platform_only landlords).';

COMMENT ON COLUMN public.landlords.signature_author_title IS
  'Printed title shown on Real Estate PDF signature blocks (platform_only landlords).';
