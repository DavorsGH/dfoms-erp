-- Script 178: SMS MFA session binding (revocable; not cookie-based).
-- No direct client access — service role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_mfa_sessions (
  auth_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  method text NOT NULL CHECK (method IN ('sms')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (auth_uid, session_key)
);

COMMENT ON TABLE public.login_mfa_sessions IS
  'Records SMS MFA satisfaction for a Supabase session (session_key = hash of refresh token).';

CREATE INDEX IF NOT EXISTS idx_login_mfa_sessions_expires
  ON public.login_mfa_sessions (expires_at);

GRANT ALL ON public.login_mfa_sessions TO service_role;
REVOKE ALL ON public.login_mfa_sessions FROM authenticated, anon;

ALTER TABLE public.login_mfa_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS login_mfa_sessions_service_role_all ON public.login_mfa_sessions;
CREATE POLICY login_mfa_sessions_service_role_all
  ON public.login_mfa_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
