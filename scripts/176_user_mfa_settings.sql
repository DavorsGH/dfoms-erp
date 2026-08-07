-- Script 176: Voluntary MFA preferences (TOTP XOR SMS per user).
-- Apply on staging first; production after verification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_mfa_settings (
  auth_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'none'
    CHECK (method IN ('none', 'totp', 'sms')),
  sms_phone_e164 text NULL,
  sms_phone_verified_at timestamptz NULL,
  totp_enrolled_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_mfa_settings IS
  'App-owned MFA preference registry. TOTP factors live in Supabase Auth; SMS uses Hubtel OTP.';

CREATE OR REPLACE FUNCTION public.user_mfa_settings_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_mfa_settings_updated_at ON public.user_mfa_settings;
CREATE TRIGGER trg_user_mfa_settings_updated_at
  BEFORE UPDATE ON public.user_mfa_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.user_mfa_settings_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.user_mfa_settings TO authenticated;
GRANT ALL ON public.user_mfa_settings TO service_role;

ALTER TABLE public.user_mfa_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_mfa_settings_select_own ON public.user_mfa_settings;
CREATE POLICY user_mfa_settings_select_own
  ON public.user_mfa_settings
  FOR SELECT
  TO authenticated
  USING (auth_uid = auth.uid());

DROP POLICY IF EXISTS user_mfa_settings_insert_own ON public.user_mfa_settings;
CREATE POLICY user_mfa_settings_insert_own
  ON public.user_mfa_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth_uid = auth.uid());

DROP POLICY IF EXISTS user_mfa_settings_update_own ON public.user_mfa_settings;
CREATE POLICY user_mfa_settings_update_own
  ON public.user_mfa_settings
  FOR UPDATE
  TO authenticated
  USING (auth_uid = auth.uid())
  WITH CHECK (auth_uid = auth.uid());

COMMIT;
