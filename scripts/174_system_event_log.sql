-- Script 174: Phase 0 observability — cross-tenant system event log.
-- Apply on staging first; production after verification.
--
-- Davors-only operational table (no tenant_id). Inserts via service_role
-- (cron/webhook routes). SELECT for Davors platform super_admin only —
-- same gate as Tenant Management: is_super_admin() AND Davors tenant.

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_event_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL
    CHECK (event_type IN ('webhook', 'cron', 'payment')),
  event_name text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('success', 'failure', 'warning')),
  message text NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.system_event_log IS
  'Cross-tenant operational audit log (webhooks, crons, payment reconciliation). '
  'No tenant_id — platform-wide. Written by service_role; readable by Davors platform super_admin.';

CREATE INDEX IF NOT EXISTS system_event_log_created_at_desc_idx
  ON public.system_event_log (created_at DESC);

CREATE INDEX IF NOT EXISTS system_event_log_status_idx
  ON public.system_event_log (status);

CREATE INDEX IF NOT EXISTS system_event_log_event_type_idx
  ON public.system_event_log (event_type);

ALTER TABLE public.system_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_event_log_davors_platform_select ON public.system_event_log;
CREATE POLICY system_event_log_davors_platform_select
  ON public.system_event_log
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  );

COMMIT;
