-- Script 148: employee_notifications.action_url
--
-- Adds a structured destination for in-app inbox click-through navigation.
-- Real Estate staff notifications previously appended the absolute URL into
-- `body`; the app now stores a relative dashboard path here instead.
--
-- Safe to re-run. Apply on staging first.

BEGIN;

ALTER TABLE public.employee_notifications
  ADD COLUMN IF NOT EXISTS action_url text;

COMMENT ON COLUMN public.employee_notifications.action_url IS
  'Optional relative dashboard path (or absolute URL) for inbox click navigation. '
  'Null for announcements that only expand in the bell.';

COMMIT;
