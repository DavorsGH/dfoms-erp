-- Landlord Portal self-service logo (separate from tenants.logo_url staff workspace branding).
ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMENT ON COLUMN public.landlords.logo_url IS
  'Landlord workspace logo shown in Landlord Portal header; uploaded via portal Workspace Settings.';

-- Seed from existing staff-entered tenant logos where present.
UPDATE public.landlords l
SET logo_url = t.logo_url
FROM public.tenants t
WHERE l.tenant_id = t.id
  AND l.logo_url IS NULL
  AND t.logo_url IS NOT NULL
  AND btrim(t.logo_url) <> '';
