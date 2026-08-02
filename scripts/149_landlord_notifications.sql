-- =============================================================================
-- 149_landlord_notifications.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Landlord Portal in-app inbox (Phase 1).
-- Mirrors employee_notifications (script 127 + 148 action_url), adapted for
-- landlords.auth_user_id. Separate from employee_notifications / lessee_notifications.
--
-- RLS: recipients read/update/delete only their own rows
--   (recipient_user_id = auth.uid() AND tenant_id = current_user_landlord_tenant_id()).
-- No is_super_admin()-alone bypass. Send path uses service_role.
--
-- Safe to re-run.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.landlord_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- landlords.auth_user_id (auth.uid() for landlord-portal JWT).
  -- Not FK to user_accounts — landlord portal users are not staff accounts.
  recipient_user_id uuid NOT NULL,
  -- Nullable for parity with employee_notifications; unused in Phase 1.
  announcement_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.landlord_notifications IS
  'In-app inbox for landlord portal users with landlords.auth_user_id set. '
  'recipient_user_id = landlords.auth_user_id (auth.uid() for portal JWT). '
  'Do NOT reuse employee_notifications or lessee_notifications. '
  'RLS: recipients read/update/delete only their own rows; send path uses service_role.';

COMMENT ON COLUMN public.landlord_notifications.action_url IS
  'Optional relative landlord-portal path (or absolute URL) for inbox click navigation. '
  'Null for rows that only expand in the bell.';

COMMENT ON COLUMN public.landlord_notifications.announcement_id IS
  'Reserved for parity with employee_notifications; unused in Phase 1.';

CREATE INDEX IF NOT EXISTS landlord_notifications_recipient_unread_idx
  ON public.landlord_notifications (tenant_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS landlord_notifications_tenant_created_idx
  ON public.landlord_notifications (tenant_id, created_at DESC);

ALTER TABLE public.landlord_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landlord_notifications_tenant_all
  ON public.landlord_notifications;
DROP POLICY IF EXISTS landlord_notifications_select_own
  ON public.landlord_notifications;
DROP POLICY IF EXISTS landlord_notifications_update_own
  ON public.landlord_notifications;
DROP POLICY IF EXISTS landlord_notifications_delete_own
  ON public.landlord_notifications;

-- Own inbox only. Never tenant-wide SELECT / no is_super_admin()-alone bypass.
CREATE POLICY landlord_notifications_select_own
  ON public.landlord_notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND tenant_id = public.current_user_landlord_tenant_id()
  );

CREATE POLICY landlord_notifications_update_own
  ON public.landlord_notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND tenant_id = public.current_user_landlord_tenant_id()
  )
  WITH CHECK (
    recipient_user_id = (SELECT auth.uid())
    AND tenant_id = public.current_user_landlord_tenant_id()
  );

CREATE POLICY landlord_notifications_delete_own
  ON public.landlord_notifications
  FOR DELETE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND tenant_id = public.current_user_landlord_tenant_id()
  );

-- Authenticated: read/mark-read/clear own rows. Inserts via service_role only.
GRANT SELECT, UPDATE, DELETE ON public.landlord_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.landlord_notifications
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
