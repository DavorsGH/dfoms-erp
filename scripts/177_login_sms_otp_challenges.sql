-- Script 177: Short-lived hashed SMS OTP challenges (Hubtel login/enrollment).
-- No direct client access — service role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_sms_otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'login'
    CHECK (purpose IN ('login', 'enrollment')),
  phone_e164 text NOT NULL,
  otp_hash text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_ip text NULL,
  hubtel_message_id text NULL
);

COMMENT ON TABLE public.login_sms_otp_challenges IS
  'Hashed SMS OTP for MFA login/enrollment. Plaintext OTP never stored.';

CREATE INDEX IF NOT EXISTS idx_login_sms_otp_active
  ON public.login_sms_otp_challenges (auth_uid, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

GRANT ALL ON public.login_sms_otp_challenges TO service_role;
REVOKE ALL ON public.login_sms_otp_challenges FROM authenticated, anon;

ALTER TABLE public.login_sms_otp_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_sms_otp_challenges_service_role_all ON public.login_sms_otp_challenges;
CREATE POLICY login_sms_otp_challenges_service_role_all
  ON public.login_sms_otp_challenges
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
