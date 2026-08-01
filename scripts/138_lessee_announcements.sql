-- =============================================================================
-- 138_lessee_announcements.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Portal Announcements (landlord/staff → lessee/tenant messaging).
-- Mirrors employee announcements (script 127 + 129 skipped_no_credit), adapted
-- for Real Estate lessees. Distinct from employee_* and Phase 7 CRM tables.
--
-- Creates:
--   lessee_message_templates
--   lessee_announcements
--   lessee_announcement_recipients
--   lessee_notifications
--
-- Tenancy:
--   tenant_id = landlord SaaS tenant (NOT DAVORS_TENANT_ID).
--   Staff compose/send via service-role admin APIs (Davors platform super admin).
--   Portal lessees read/update own inbox rows via RLS + auth.uid().
--
-- audience_filter jsonb:
--   { "type": "all" }
--   or { "type": "filtered", "property_ids": uuid[], "lease_ids": uuid[],
--        "lessee_ids": uuid[] }  (OR-union, de-duplicated by lessee_id)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. lessee_message_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessee_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL
    CONSTRAINT lessee_message_templates_channel_check
      CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text, 'both'::text])),
  subject text,
  body text NOT NULL,
  created_by uuid REFERENCES public.user_accounts (auth_uid) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessee_message_templates_email_subject_chk CHECK (
    channel = 'sms'
    OR subject IS NULL
    OR length(btrim(subject)) > 0
  )
);

COMMENT ON TABLE public.lessee_message_templates IS
  'Reusable templates for Real Estate portal (lessee) announcements (email/sms/both). '
  'tenant_id = landlord tenant. Separate from employee_message_templates and Phase 7 message_templates.';

COMMENT ON COLUMN public.lessee_message_templates.subject IS
  'Email subject when channel includes email; ignored for sms-only.';

CREATE INDEX IF NOT EXISTS lessee_message_templates_tenant_active_idx
  ON public.lessee_message_templates (tenant_id, is_active, name);

ALTER TABLE public.lessee_message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_message_templates_tenant_all
  ON public.lessee_message_templates;
CREATE POLICY lessee_message_templates_tenant_all
  ON public.lessee_message_templates
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_message_templates
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_message_templates
  TO service_role;

-- ---------------------------------------------------------------------------
-- 2. lessee_announcements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessee_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  -- Allocated on save via generate_next_code(tenant_id, 'LANNC', 4).
  announcement_code text,
  name text NOT NULL,
  template_id uuid REFERENCES public.lessee_message_templates (id) ON DELETE SET NULL,
  channels text[] NOT NULL
    CONSTRAINT lessee_announcements_channels_nonempty_check
      CHECK (cardinality(channels) >= 1),
  CONSTRAINT lessee_announcements_channels_values_check
    CHECK (channels <@ ARRAY['email'::text, 'sms'::text, 'in_app'::text]),
  subject text,
  body text,
  audience_filter jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT lessee_announcements_status_check
      CHECK (status = ANY (ARRAY[
        'draft'::text, 'sending'::text, 'sent'::text, 'failed'::text
      ])),
  created_by uuid REFERENCES public.user_accounts (auth_uid) ON DELETE SET NULL,
  total_recipients integer NOT NULL DEFAULT 0
    CONSTRAINT lessee_announcements_total_recipients_nonneg
      CHECK (total_recipients >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT lessee_announcements_content_chk CHECK (
    template_id IS NOT NULL
    OR (body IS NOT NULL AND length(btrim(body)) > 0)
  )
);

COMMENT ON TABLE public.lessee_announcements IS
  'Landlord-scoped portal announcement campaigns to lessees. Channels: email, sms, in_app. '
  'audience_filter: { "type": "all" } or '
  '{ "type": "filtered", "property_ids": [], "lease_ids": [], "lessee_ids": [] } (OR-union).';

COMMENT ON COLUMN public.lessee_announcements.announcement_code IS
  'Auto-generated via generate_next_code(tenant_id, ''LANNC'', 4) on save (app-side).';

COMMENT ON COLUMN public.lessee_announcements.template_id IS
  'Nullable — ad-hoc subject/body allowed when no template is selected.';

CREATE UNIQUE INDEX IF NOT EXISTS lessee_announcements_tenant_code_uidx
  ON public.lessee_announcements (tenant_id, announcement_code)
  WHERE announcement_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS lessee_announcements_tenant_status_idx
  ON public.lessee_announcements (tenant_id, status, created_at DESC);

ALTER TABLE public.lessee_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_announcements_tenant_all
  ON public.lessee_announcements;
CREATE POLICY lessee_announcements_tenant_all
  ON public.lessee_announcements
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_announcements
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_announcements
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. lessee_announcement_recipients
-- ---------------------------------------------------------------------------
-- Ensure UNIQUE (tenant_id, lessee_id) so composite FK works regardless of
-- whether lessees PK is single-column or already composite.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'lessees'
      AND c.contype IN ('p', 'u')
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['tenant_id', 'lessee_id']::text[]
  ) THEN
    ALTER TABLE public.lessees
      ADD CONSTRAINT lessees_tenant_id_lessee_id_key
      UNIQUE (tenant_id, lessee_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.lessee_announcement_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL
    REFERENCES public.lessee_announcements (id) ON DELETE CASCADE,
  lessee_id uuid NOT NULL,
  channel text NOT NULL
    CONSTRAINT lessee_announcement_recipients_channel_check
      CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text, 'in_app'::text])),
  status text NOT NULL
    CONSTRAINT lessee_announcement_recipients_status_check
      CHECK (status = ANY (ARRAY[
        'sent'::text,
        'failed'::text,
        'skipped_no_contact'::text,
        'skipped_no_login'::text,
        'skipped_no_credit'::text
      ])),
  sent_at timestamptz,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessee_announcement_recipients_lessee_fkey
    FOREIGN KEY (tenant_id, lessee_id)
    REFERENCES public.lessees (tenant_id, lessee_id)
    ON DELETE CASCADE,
  CONSTRAINT lessee_announcement_recipients_unique
    UNIQUE (announcement_id, lessee_id, channel)
);

COMMENT ON TABLE public.lessee_announcement_recipients IS
  'Per-lessee, per-channel delivery attempt for a portal announcement. '
  'FK is composite (tenant_id, lessee_id) → lessees. '
  'Includes skipped_no_credit (SMS wallet) from day one (employee script 129).';

COMMENT ON COLUMN public.lessee_announcement_recipients.error_detail IS
  'Provider or skip reason detail (nullable).';

CREATE INDEX IF NOT EXISTS lessee_announcement_recipients_tenant_announcement_idx
  ON public.lessee_announcement_recipients (tenant_id, announcement_id);

CREATE INDEX IF NOT EXISTS lessee_announcement_recipients_lessee_idx
  ON public.lessee_announcement_recipients (tenant_id, lessee_id);

ALTER TABLE public.lessee_announcement_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_announcement_recipients_tenant_all
  ON public.lessee_announcement_recipients;
CREATE POLICY lessee_announcement_recipients_tenant_all
  ON public.lessee_announcement_recipients
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_announcement_recipients
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_announcement_recipients
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. lessee_notifications (portal in-app inbox)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessee_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  lessee_id uuid NOT NULL,
  announcement_id uuid
    REFERENCES public.lessee_announcements (id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lessee_notifications_lessee_fkey
    FOREIGN KEY (tenant_id, lessee_id)
    REFERENCES public.lessees (tenant_id, lessee_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.lessee_notifications IS
  'In-app inbox for portal lessees with auth_user_id set. '
  'recipient_user_id = lessees.auth_user_id (auth.uid() for portal JWT). '
  'Do NOT reuse employee_notifications. '
  'RLS: recipients read/update only their own rows; send path uses service_role.';

CREATE INDEX IF NOT EXISTS lessee_notifications_recipient_unread_idx
  ON public.lessee_notifications (tenant_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS lessee_notifications_announcement_idx
  ON public.lessee_notifications (announcement_id)
  WHERE announcement_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lessee_notifications_lessee_idx
  ON public.lessee_notifications (tenant_id, lessee_id, created_at DESC);

ALTER TABLE public.lessee_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_notifications_tenant_all
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_select_own
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_update_own
  ON public.lessee_notifications;
DROP POLICY IF EXISTS lessee_notifications_delete_own
  ON public.lessee_notifications;

-- Own inbox only (mark-as-read). Never landlord-wide SELECT for portal JWTs.
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

-- Staff send path uses service_role (bypasses RLS). Optional landlord-tenant
-- SELECT for future landlord console (not used by Davors platform admin client).
DROP POLICY IF EXISTS lessee_notifications_tenant_select
  ON public.lessee_notifications;
CREATE POLICY lessee_notifications_tenant_select
  ON public.lessee_notifications
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT, UPDATE, DELETE ON public.lessee_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lessee_notifications
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
