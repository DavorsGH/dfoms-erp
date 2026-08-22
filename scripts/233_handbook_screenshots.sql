-- =============================================================================
-- 233_handbook_screenshots.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Platform-wide handbook UI screenshots (not tenant-scoped).
-- Metadata in public.handbook_screenshots; files in storage bucket
-- handbook-screenshots (private — display via signed URLs when wired).
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.handbook_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_key text NOT NULL,
  file_path text NOT NULL,
  caption text NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handbook_screenshots_section_key_idx
  ON public.handbook_screenshots (section_key);

CREATE INDEX IF NOT EXISTS handbook_screenshots_section_display_order_idx
  ON public.handbook_screenshots (section_key, display_order);

ALTER TABLE public.handbook_screenshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS handbook_screenshots_select_authenticated ON public.handbook_screenshots;
CREATE POLICY handbook_screenshots_select_authenticated
  ON public.handbook_screenshots
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.handbook_screenshots TO authenticated;

COMMENT ON TABLE public.handbook_screenshots IS
  'Davors platform handbook UI screenshots (not tenant-scoped). file_path is a path within the handbook-screenshots storage bucket.';

COMMENT ON COLUMN public.handbook_screenshots.section_key IS
  'Handbook section reference, e.g. 7.7 — matches handbook section numbering for future retrieval wiring.';

COMMENT ON COLUMN public.handbook_screenshots.file_path IS
  'Storage object path within the handbook-screenshots bucket (not a full URL).';

COMMENT ON COLUMN public.handbook_screenshots.caption IS
  'Optional caption shown with the screenshot in assistant replies.';

COMMENT ON COLUMN public.handbook_screenshots.display_order IS
  'Sort order when multiple screenshots exist for the same section_key (lower first).';

-- Private bucket — same convention as tenant-logos post script 163 (signed URLs for display).
INSERT INTO storage.buckets (id, name, public)
VALUES ('handbook-screenshots', 'handbook-screenshots', false)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS handbook_screenshots_select_authenticated ON storage.objects;
CREATE POLICY handbook_screenshots_select_authenticated
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'handbook-screenshots');

COMMIT;
