ALTER TABLE public.campaigns
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS subject text;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS body_email text;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS body_sms text;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_content_chk;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_content_chk CHECK (
    template_id IS NOT NULL
    OR (
      (
        body_email IS NOT NULL
        AND length(btrim(body_email)) > 0
      )
      OR (
        body_sms IS NOT NULL
        AND length(btrim(body_sms)) > 0
      )
    )
  );
