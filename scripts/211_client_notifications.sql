-- =============================================================================
-- 211_client_notifications.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Customer portal in-app inbox for client-role dashboard users.
-- Mirrors landlord_notifications / lessee_notifications.
--
-- RLS: recipients read/update/delete only their own rows
--   (recipient_user_id = auth.uid() AND client_id = current_user_client_id()).
-- Send path uses service_role.
--
-- Safe to re-run.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.client_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  client_id text NOT NULL,
  announcement_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_notifications_tenant_client_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.customers (tenant_id, client_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.client_notifications IS
  'In-app inbox for customer portal users (user_accounts.role = client). '
  'recipient_user_id = user_accounts.auth_uid. '
  'RLS: own rows only; inserts via service_role.';

CREATE INDEX IF NOT EXISTS client_notifications_recipient_unread_idx
  ON public.client_notifications (tenant_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS client_notifications_tenant_client_created_idx
  ON public.client_notifications (tenant_id, client_id, created_at DESC);

ALTER TABLE public.client_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_notifications_select_own
  ON public.client_notifications;
DROP POLICY IF EXISTS client_notifications_update_own
  ON public.client_notifications;
DROP POLICY IF EXISTS client_notifications_delete_own
  ON public.client_notifications;

CREATE POLICY client_notifications_select_own
  ON public.client_notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND client_id = public.current_user_client_id()
    AND public.tenant_matches(tenant_id)
  );

CREATE POLICY client_notifications_update_own
  ON public.client_notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND client_id = public.current_user_client_id()
    AND public.tenant_matches(tenant_id)
  )
  WITH CHECK (
    recipient_user_id = (SELECT auth.uid())
    AND client_id = public.current_user_client_id()
    AND public.tenant_matches(tenant_id)
  );

CREATE POLICY client_notifications_delete_own
  ON public.client_notifications
  FOR DELETE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND client_id = public.current_user_client_id()
    AND public.tenant_matches(tenant_id)
  );

GRANT SELECT, UPDATE, DELETE ON public.client_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_notifications
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
