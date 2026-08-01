-- Script 137: Internal URL shortener for SMS deep-links (Real Estate staff alerts).
-- SCHEMA CHANGE: new public.short_links table.
-- Maps short random codes → absolute destination URLs; resolved by GET /s/[code].
-- Access is service-role only (admin client insert + lookup). RLS enabled with no
-- anon/authenticated policies so Data API clients cannot read or write rows.
-- Apply in Supabase SQL Editor (staging first, then production).

BEGIN;

CREATE TABLE IF NOT EXISTS public.short_links (
  code text PRIMARY KEY,
  destination_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

COMMENT ON TABLE public.short_links IS
  'Internal short URLs for SMS deep-links (e.g. /s/{code} → absolute dashboard URL).';

COMMENT ON COLUMN public.short_links.code IS
  'Random 6–8 character public path segment (unique).';

COMMENT ON COLUMN public.short_links.destination_url IS
  'Absolute destination URL (preferred). Redirect route resolves relative URLs against NEXT_PUBLIC_SITE_URL.';

COMMENT ON COLUMN public.short_links.expires_at IS
  'Optional expiry; NULL means never expires. Expired codes return 404.';

CREATE INDEX IF NOT EXISTS short_links_created_at_idx
  ON public.short_links (created_at DESC);

ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated: only service_role (bypasses RLS) may access.
REVOKE ALL ON TABLE public.short_links FROM PUBLIC;
REVOKE ALL ON TABLE public.short_links FROM anon;
REVOKE ALL ON TABLE public.short_links FROM authenticated;
GRANT ALL ON TABLE public.short_links TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
