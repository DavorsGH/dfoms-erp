-- Script 229: Manual Hubtel programmable SMS balance readings (platform super-admin).
-- Insert-only audit log; no client access — service role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hubtel_balance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_ghs numeric(12, 4) NOT NULL CHECK (amount_ghs >= 0),
  logged_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES auth.users(id),
  note text NULL
);

COMMENT ON TABLE public.hubtel_balance_log IS
  'Timestamped Hubtel dashboard balance readings for platform SMS cost estimation.';

CREATE INDEX IF NOT EXISTS idx_hubtel_balance_log_logged_at
  ON public.hubtel_balance_log (logged_at DESC);

GRANT ALL ON public.hubtel_balance_log TO service_role;
REVOKE ALL ON public.hubtel_balance_log FROM authenticated, anon;

ALTER TABLE public.hubtel_balance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hubtel_balance_log_service_role_all ON public.hubtel_balance_log;
CREATE POLICY hubtel_balance_log_service_role_all
  ON public.hubtel_balance_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
