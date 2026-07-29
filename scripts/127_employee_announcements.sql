-- =============================================================================
-- 127_employee_announcements.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Employee Announcements (internal tenant → employee comms).
-- Distinct from Phase 7 customer Email & Promotions (message_templates / campaigns).
--
-- Creates:
--   employee_message_templates
--   employee_announcements
--   employee_announcement_recipients
--   employee_notifications
--
-- RLS:
--   templates / announcements / recipients — Phase 7 style *_tenant_all
--     FOR ALL USING (tenant_matches(tenant_id)) WITH CHECK (tenant_matches(tenant_id))
--   employee_notifications — inbox privacy (NOT tenant-wide SELECT):
--     SELECT/UPDATE/DELETE: tenant_matches AND recipient_user_id = auth.uid()
--     INSERT (send path): tenant_matches AND current_user_role() IN (super_admin, hr)
--   No is_super_admin()-alone policies (same class fixed by scripts 69 / 118 / 128).
--
-- Pre-flight — see scripts/_preflight-employee-announcements.ts / .sql:
--   • employees: use composite FK (tenant_id, employee_id). Live staging rejected
--     REFERENCES employees(employee_id) with 42830 — employee_id alone is not unique
--     (script 98 composite PK is the live shape; do not assume 101 single-column PK).
--   • user_accounts PK = (auth_uid)
--   • tenant_matches(p_tenant_id uuid) EXISTS
--   • generate_next_code(p_tenant_id, p_entity_type, p_padding) EXISTS (app-side ANNC)
--   • none of the 4 new table names collide; message_templates/campaigns remain CRM
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. employee_message_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL
    CONSTRAINT employee_message_templates_channel_check
      CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text, 'both'::text])),
  subject text,
  body text NOT NULL,
  created_by uuid REFERENCES public.user_accounts (auth_uid) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_message_templates_email_subject_chk CHECK (
    channel = 'sms'
    OR subject IS NULL
    OR length(btrim(subject)) > 0
  )
);

COMMENT ON TABLE public.employee_message_templates IS
  'Reusable templates for internal employee announcements (email/sms/both). '
  'Separate from customer-facing message_templates (Phase 7 Email & Promotions).';

COMMENT ON COLUMN public.employee_message_templates.subject IS
  'Email subject when channel includes email; ignored for sms-only.';

CREATE INDEX IF NOT EXISTS employee_message_templates_tenant_active_idx
  ON public.employee_message_templates (tenant_id, is_active, name);

DROP TRIGGER IF EXISTS trg_employee_message_templates_enforce_tenant_id
  ON public.employee_message_templates;
CREATE TRIGGER trg_employee_message_templates_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.employee_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_row_tenant_id();

ALTER TABLE public.employee_message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_message_templates_tenant_all
  ON public.employee_message_templates;
CREATE POLICY employee_message_templates_tenant_all
  ON public.employee_message_templates
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_message_templates
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_message_templates
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. employee_announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- Allocated on save via generate_next_code(tenant_id, 'ANNC', 4) — same as CAMP.
  announcement_code text,
  name text NOT NULL,
  template_id uuid REFERENCES public.employee_message_templates (id) ON DELETE SET NULL,
  channels text[] NOT NULL
    CONSTRAINT employee_announcements_channels_nonempty_check
      CHECK (cardinality(channels) >= 1),
  CONSTRAINT employee_announcements_channels_values_check
    CHECK (channels <@ ARRAY['email'::text, 'sms'::text, 'in_app'::text]),
  subject text,
  body text,
  audience_filter jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT employee_announcements_status_check
      CHECK (status = ANY (ARRAY[
        'draft'::text, 'sending'::text, 'sent'::text, 'failed'::text
      ])),
  created_by uuid REFERENCES public.user_accounts (auth_uid) ON DELETE SET NULL,
  total_recipients integer NOT NULL DEFAULT 0
    CONSTRAINT employee_announcements_total_recipients_nonneg
      CHECK (total_recipients >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT employee_announcements_content_chk CHECK (
    template_id IS NOT NULL
    OR (body IS NOT NULL AND length(btrim(body)) > 0)
  )
);

COMMENT ON TABLE public.employee_announcements IS
  'Internal employee announcement sends. Channels may combine email, sms, and in_app. '
  'audience_filter jsonb: { "type": "all" } or '
  '{ "type": "filtered", "positions": string[], "shifts": string[], '
  '"employment_types": string[], "employee_ids": string[] } (OR-union). '
  'Legacy single-criterion shapes are still accepted on read.';

COMMENT ON COLUMN public.employee_announcements.announcement_code IS
  'Auto-generated via generate_next_code(tenant_id, ''ANNC'', 4) on save (app-side).';

COMMENT ON COLUMN public.employee_announcements.template_id IS
  'Nullable — ad-hoc subject/body allowed when no template is selected.';

CREATE UNIQUE INDEX IF NOT EXISTS employee_announcements_tenant_code_uidx
  ON public.employee_announcements (tenant_id, announcement_code)
  WHERE announcement_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS employee_announcements_tenant_status_idx
  ON public.employee_announcements (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_employee_announcements_enforce_tenant_id
  ON public.employee_announcements;
CREATE TRIGGER trg_employee_announcements_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.employee_announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_row_tenant_id();

ALTER TABLE public.employee_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_announcements_tenant_all
  ON public.employee_announcements;
CREATE POLICY employee_announcements_tenant_all
  ON public.employee_announcements
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_announcements
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_announcements
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. employee_announcement_recipients
-- ---------------------------------------------------------------------------
-- employees live unique key for FKs is (tenant_id, employee_id):
--   • Staging rejected REFERENCES (employee_id) with SQLSTATE 42830
--     (no unique constraint matching employee_id alone).
--   • Script 98 made PRIMARY KEY (tenant_id, employee_id); do not assume 101
--     single-column rollback is present on every environment.
-- Ensure UNIQUE (tenant_id, employee_id) exists so this FK works whether the
-- live PK is already the composite or is still single-column (employee_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'employees'
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['tenant_id', 'employee_id']::text[]
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT employees_tenant_id_employee_id_key
      UNIQUE (tenant_id, employee_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.employee_announcement_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL
    REFERENCES public.employee_announcements (id) ON DELETE CASCADE,
  employee_id text NOT NULL,
  channel text NOT NULL
    CONSTRAINT employee_announcement_recipients_channel_check
      CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text, 'in_app'::text])),
  status text NOT NULL
    CONSTRAINT employee_announcement_recipients_status_check
      CHECK (status = ANY (ARRAY[
        'sent'::text,
        'failed'::text,
        'skipped_no_contact'::text,
        'skipped_no_login'::text
      ])),
  sent_at timestamptz,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_announcement_recipients_employee_fkey
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, employee_id)
    ON DELETE CASCADE,
  CONSTRAINT employee_announcement_recipients_unique
    UNIQUE (announcement_id, employee_id, channel)
);

COMMENT ON TABLE public.employee_announcement_recipients IS
  'Per-employee, per-channel delivery attempt for an announcement. '
  'One row per channel when multi-channel send is selected. '
  'FK is composite (tenant_id, employee_id) → employees.';

COMMENT ON COLUMN public.employee_announcement_recipients.error_detail IS
  'Provider or skip reason detail (nullable). Named error_detail (not Phase 7 error).';

CREATE INDEX IF NOT EXISTS employee_announcement_recipients_tenant_announcement_idx
  ON public.employee_announcement_recipients (tenant_id, announcement_id);

CREATE INDEX IF NOT EXISTS employee_announcement_recipients_employee_idx
  ON public.employee_announcement_recipients (tenant_id, employee_id);

DROP TRIGGER IF EXISTS trg_employee_announcement_recipients_enforce_tenant_id
  ON public.employee_announcement_recipients;
CREATE TRIGGER trg_employee_announcement_recipients_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.employee_announcement_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_row_tenant_id();

ALTER TABLE public.employee_announcement_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_announcement_recipients_tenant_all
  ON public.employee_announcement_recipients;
CREATE POLICY employee_announcement_recipients_tenant_all
  ON public.employee_announcement_recipients
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_announcement_recipients
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_announcement_recipients
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. employee_notifications (in-app inbox)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL
    REFERENCES public.user_accounts (auth_uid) ON DELETE CASCADE,
  announcement_id uuid
    REFERENCES public.employee_announcements (id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_notifications IS
  'In-app inbox rows for users with a real login (user_accounts.auth_uid). '
  'announcement_id is nullable so future non-announcement notifications can reuse this table. '
  'RLS: recipients read/update/delete only their own rows; HR/super_admin may INSERT '
  'within tenant (send path). Admin delivery status lives on employee_announcement_recipients, '
  'not by browsing other employees'' inboxes.';

CREATE INDEX IF NOT EXISTS employee_notifications_recipient_unread_idx
  ON public.employee_notifications (tenant_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS employee_notifications_announcement_idx
  ON public.employee_notifications (announcement_id)
  WHERE announcement_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_employee_notifications_enforce_tenant_id
  ON public.employee_notifications;
CREATE TRIGGER trg_employee_notifications_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.employee_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_row_tenant_id();

ALTER TABLE public.employee_notifications ENABLE ROW LEVEL SECURITY;

-- Drop legacy draft policy if a prior draft apply used tenant-wide ALL.
DROP POLICY IF EXISTS employee_notifications_tenant_all
  ON public.employee_notifications;
DROP POLICY IF EXISTS employee_notifications_select_own
  ON public.employee_notifications;
DROP POLICY IF EXISTS employee_notifications_update_own
  ON public.employee_notifications;
DROP POLICY IF EXISTS employee_notifications_delete_own
  ON public.employee_notifications;
DROP POLICY IF EXISTS employee_notifications_insert_hr
  ON public.employee_notifications;

-- Own inbox only (mark-as-read / clear). Never tenant-wide SELECT.
CREATE POLICY employee_notifications_select_own
  ON public.employee_notifications
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND recipient_user_id = auth.uid()
  );

CREATE POLICY employee_notifications_update_own
  ON public.employee_notifications
  FOR UPDATE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND recipient_user_id = auth.uid()
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND recipient_user_id = auth.uid()
  );

CREATE POLICY employee_notifications_delete_own
  ON public.employee_notifications
  FOR DELETE
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND recipient_user_id = auth.uid()
  );

-- Send path: HR / tenant super_admin may insert for any recipient in-tenant.
-- No SELECT grant for other recipients' rows (admin sent-list = recipients table).
CREATE POLICY employee_notifications_insert_hr
  ON public.employee_notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'hr'::app_role
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_notifications
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_notifications
  TO service_role;

COMMIT;
