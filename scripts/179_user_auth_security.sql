-- Script 179: Per-user password metadata for policy nudge cutoff (not password storage).
-- password_updated_at = last voluntary password set (signup / self-service change / recovery).

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_auth_security (
  auth_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_auth_security IS
  'Security metadata keyed by auth.users.id. password_updated_at drives password-policy in-app nudges.';

COMMENT ON COLUMN public.user_auth_security.password_updated_at IS
  'When the user last set their password (signup, change-password, or recovery reset).';

-- Best available proxy for existing accounts (auth.users has no dedicated password_changed_at).
INSERT INTO public.user_auth_security (auth_uid, password_updated_at)
SELECT id, COALESCE(created_at, now())
FROM auth.users
ON CONFLICT (auth_uid) DO NOTHING;

ALTER TABLE public.user_auth_security ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_auth_security_select_own ON public.user_auth_security;
CREATE POLICY user_auth_security_select_own
  ON public.user_auth_security
  FOR SELECT
  TO authenticated
  USING (auth_uid = auth.uid());

GRANT SELECT ON public.user_auth_security TO authenticated;
GRANT ALL ON public.user_auth_security TO service_role;

COMMIT;
