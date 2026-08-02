-- =============================================================================
-- 150_lessee_notifications_action_url.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Adds action_url to lessee_notifications (same pattern as script 148 for
-- employee_notifications) and tightens RLS to self-read-only (drop landlord-
-- tenant SELECT) to match employee_notifications privacy.
--
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE public.lessee_notifications
  ADD COLUMN IF NOT EXISTS action_url text;

COMMENT ON COLUMN public.lessee_notifications.action_url IS
  'Optional relative portal path (or absolute URL) for inbox click navigation. '
  'Null for announcements that only expand in the bell.';

-- Drop landlord-tenant-wide SELECT if present (script 138). Own-inbox only.
DROP POLICY IF EXISTS lessee_notifications_tenant_select
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_tenant_all
  ON public.lessee_notifications;

-- Re-assert own-inbox policies (idempotent).
DROP POLICY IF EXISTS lessee_notifications_select_own
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_update_own
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_delete_own
  ON public.lessee_notifications;

CREATE POLICY lessee_notifications_select_own
  ON public.lessee_notifications
  FOR SELECT
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND lessee_id = public.current_user_lessee_id()
  );

CREATE POLICY lessee_notifications_update_own
  ON public.lessee_notifications
  FOR UPDATE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND lessee_id = public.current_user_lessee_id()
  )
  WITH CHECK (
    recipient_user_id = (SELECT auth.uid())
    AND lessee_id = public.current_user_lessee_id()
  );

CREATE POLICY lessee_notifications_delete_own
  ON public.lessee_notifications
  FOR DELETE
  TO authenticated
  USING (
    recipient_user_id = (SELECT auth.uid())
    AND lessee_id = public.current_user_lessee_id()
  );

GRANT SELECT, UPDATE, DELETE ON public.lessee_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_notifications
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
