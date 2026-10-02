BEGIN;

CREATE TABLE IF NOT EXISTS public.statutory_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  statutory_type text NOT NULL,
  period_month date NOT NULL,
  reminder_kind text NOT NULL,
  channel text NOT NULL,
  recipient_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  error_message text NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT statutory_reminder_log_dedup UNIQUE (
    tenant_id,
    statutory_type,
    period_month,
    reminder_kind,
    channel,
    recipient_user_id
  ),
  CONSTRAINT statutory_reminder_log_channel_check CHECK (
    channel IN ('in_app', 'sms')
  ),
  CONSTRAINT statutory_reminder_log_status_check CHECK (
    status IN ('sent', 'failed', 'skipped')
  )
);

CREATE INDEX IF NOT EXISTS statutory_reminder_log_tenant_sent_at_idx
  ON public.statutory_reminder_log (tenant_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS statutory_reminder_log_period_idx
  ON public.statutory_reminder_log (tenant_id, statutory_type, period_month);

DROP TRIGGER IF EXISTS trg_statutory_reminder_log_enforce_tenant_id
  ON public.statutory_reminder_log;
CREATE TRIGGER trg_statutory_reminder_log_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.statutory_reminder_log
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.statutory_reminder_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_reminder_log_finance_select
  ON public.statutory_reminder_log;
CREATE POLICY statutory_reminder_log_finance_select
  ON public.statutory_reminder_log
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'finance'::app_role,
      'director'::app_role
    )
  );

GRANT SELECT ON public.statutory_reminder_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.statutory_reminder_log TO service_role;

REVOKE ALL ON TABLE public.statutory_reminder_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.statutory_reminder_log FROM authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
