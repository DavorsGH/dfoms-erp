-- 302_email_delivery_events_resend_webhooks.sql
-- Resend webhook delivery/open tracking (Phase 1: quotations UI).

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE SET NULL,
  resend_message_id text NOT NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_delivery_events_event_type_check CHECK (
    event_type IN (
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'delivery_delayed'
    )
  )
);

CREATE INDEX IF NOT EXISTS email_delivery_events_resend_message_id_idx
  ON public.email_delivery_events (resend_message_id);

CREATE INDEX IF NOT EXISTS email_delivery_events_tenant_occurred_idx
  ON public.email_delivery_events (tenant_id, occurred_at DESC)
  WHERE tenant_id IS NOT NULL;

COMMENT ON TABLE public.email_delivery_events IS
  'Resend webhook lifecycle events keyed by resend_message_id (email id).';

ALTER TABLE public.client_notifications
  ADD COLUMN IF NOT EXISTS notification_context text,
  ADD COLUMN IF NOT EXISTS resend_message_id text;

CREATE INDEX IF NOT EXISTS client_notifications_resend_message_id_idx
  ON public.client_notifications (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_notifications_notification_context_idx
  ON public.client_notifications (tenant_id, notification_context)
  WHERE notification_context IS NOT NULL;

COMMENT ON COLUMN public.client_notifications.notification_context IS
  'Stable send correlation key, e.g. quotation_sent/{uuid}.';

COMMENT ON COLUMN public.client_notifications.resend_message_id IS
  'Resend email id when a transactional email was sent for this inbox row.';

CREATE TABLE IF NOT EXISTS public.transactional_notification_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  event_type text NOT NULL,
  customer_id text NOT NULL,
  resend_message_id text,
  notification_context text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactional_notification_email_log_customer_fkey
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.customers (tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_notif_email_log_tenant_created
  ON public.transactional_notification_email_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_txn_notif_email_log_resend_message_id
  ON public.transactional_notification_email_log (resend_message_id)
  WHERE resend_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_txn_notif_email_log_notification_context
  ON public.transactional_notification_email_log (tenant_id, notification_context)
  WHERE notification_context IS NOT NULL;

COMMENT ON TABLE public.transactional_notification_email_log IS
  'Resend email audit trail for fireTransactionalNotification (mirrors SMS log).';

DROP TRIGGER IF EXISTS trg_transactional_notification_email_log_enforce_tenant_id
  ON public.transactional_notification_email_log;
CREATE TRIGGER trg_transactional_notification_email_log_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.transactional_notification_email_log
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_delivery_events TO authenticated;
GRANT ALL ON public.email_delivery_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactional_notification_email_log TO authenticated;
GRANT ALL ON public.transactional_notification_email_log TO service_role;

ALTER TABLE public.email_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactional_notification_email_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_delivery_events_tenant_select ON public.email_delivery_events;
CREATE POLICY email_delivery_events_tenant_select
  ON public.email_delivery_events
  FOR SELECT
  TO authenticated
  USING (tenant_id IS NOT NULL AND tenant_matches(tenant_id));

DROP POLICY IF EXISTS transactional_notification_email_log_tenant_all
  ON public.transactional_notification_email_log;
CREATE POLICY transactional_notification_email_log_tenant_all
  ON public.transactional_notification_email_log
  FOR ALL
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
