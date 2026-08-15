-- =============================================================================
-- 219_security_notification_dismissals.sql
-- Per-user security nudge delete cooldowns (MFA + password reminders).
-- Safe to re-run on staging and production.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.security_notification_dismissals (
  auth_uid uuid NOT NULL,
  nudge_type text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_uid, nudge_type)
);

COMMENT ON TABLE public.security_notification_dismissals IS
  'Per-user security nudge delete cooldowns. Does not change MFA enrollment or password compliance.';

COMMENT ON COLUMN public.security_notification_dismissals.nudge_type IS
  'mfa_enrollment = 2FA inbox nudge; password_update = password-policy inbox nudge.';

ALTER TABLE public.security_notification_dismissals
  DROP CONSTRAINT IF EXISTS security_notification_dismissals_nudge_type_check;

ALTER TABLE public.security_notification_dismissals
  ADD CONSTRAINT security_notification_dismissals_nudge_type_check
  CHECK (nudge_type IN ('mfa_enrollment', 'password_update'));

CREATE INDEX IF NOT EXISTS security_notification_dismissals_dismissed_at_idx
  ON public.security_notification_dismissals (nudge_type, dismissed_at DESC);

ALTER TABLE public.security_notification_dismissals ENABLE ROW LEVEL SECURITY;

COMMIT;
