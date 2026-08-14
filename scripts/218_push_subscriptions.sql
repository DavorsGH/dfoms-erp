-- =============================================================================
-- 218_push_subscriptions.sql
-- Web Push subscription storage for staff, lessee, and landlord portal users.
-- Apply to staging first. Do NOT apply to production until approved.
--
-- RLS: authenticated users manage only their own rows (recipient_user_id = auth.uid()).
-- Send path uses service_role via utils/web-push-send.ts.
-- Safe to re-run.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  persona text NOT NULL
    CHECK (persona IN ('staff', 'lessee', 'landlord')),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  is_standalone_pwa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

COMMENT ON TABLE public.push_subscriptions IS
  'Browser Web Push subscriptions keyed by Push API endpoint (one row per device/browser). '
  'persona disambiguates staff dashboard vs tenant portal vs landlord portal surfaces.';

COMMENT ON COLUMN public.push_subscriptions.is_standalone_pwa IS
  'Captured at subscribe time. iOS requires standalone (home-screen) install for push.';

CREATE INDEX IF NOT EXISTS push_subscriptions_recipient_active_idx
  ON public.push_subscriptions (persona, recipient_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_idx
  ON public.push_subscriptions (tenant_id, created_at DESC);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;

CREATE POLICY push_subscriptions_select_own
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_insert_own
  ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (recipient_user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_update_own
  ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()))
  WITH CHECK (recipient_user_id = (SELECT auth.uid()));

CREATE POLICY push_subscriptions_delete_own
  ON public.push_subscriptions
  FOR DELETE
  TO authenticated
  USING (recipient_user_id = (SELECT auth.uid()));

COMMIT;
