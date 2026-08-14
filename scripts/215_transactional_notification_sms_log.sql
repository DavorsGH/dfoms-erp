-- Script 215: Audit log for transactional notification SMS sends (Hubtel MessageId).
-- Apply staging first; production after verification.

BEGIN;

CREATE TABLE IF NOT EXISTS public.transactional_notification_sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  customer_id text NOT NULL,
  phone text NOT NULL,
  hubtel_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactional_notification_sms_log_customer_fkey
    FOREIGN KEY (tenant_id, customer_id)
    REFERENCES public.customers(tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_notif_sms_log_tenant_created
  ON public.transactional_notification_sms_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_txn_notif_sms_log_hubtel_message_id
  ON public.transactional_notification_sms_log (hubtel_message_id)
  WHERE hubtel_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_txn_notif_sms_log_tenant_customer
  ON public.transactional_notification_sms_log (tenant_id, customer_id, created_at DESC);

COMMENT ON TABLE public.transactional_notification_sms_log IS
  'Hubtel SMS audit trail for fireTransactionalNotification. '
  'hubtel_message_id supports GET /v1/messages/{id} delivery lookups.';

DROP TRIGGER IF EXISTS trg_transactional_notification_sms_log_enforce_tenant_id
  ON public.transactional_notification_sms_log;
CREATE TRIGGER trg_transactional_notification_sms_log_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.transactional_notification_sms_log
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactional_notification_sms_log TO authenticated;
GRANT ALL ON public.transactional_notification_sms_log TO service_role;

ALTER TABLE public.transactional_notification_sms_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactional_notification_sms_log_tenant_all
  ON public.transactional_notification_sms_log;
CREATE POLICY transactional_notification_sms_log_tenant_all
  ON public.transactional_notification_sms_log
  FOR ALL
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

COMMIT;

NOTIFY pgrst, 'reload schema';
