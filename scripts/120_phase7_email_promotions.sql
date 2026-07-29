-- ============================================================================
-- Script 120: Phase 7 — Email & Promotions / SMS foundational schema
-- Tenant-facing platform feature: tenants message their OWN customers
-- (marketing campaigns + transactional notification rules), not Davors'
-- own outbound comms.
--
-- Tables created:
--   1. message_templates              - reusable email/SMS content
--   2. customer_comm_preferences      - opt-in/opt-out + unsubscribe tracking
--   3. campaigns                      - marketing campaign definitions
--   4. campaign_recipients            - per-customer send tracking
--   5. transactional_notification_rules - event -> template wiring per tenant
--
-- RLS pattern: mirrors billing_settings_tenant_all exactly
--   (tenant_matches(tenant_id) on both USING and WITH CHECK).
--
-- Run in: Supabase SQL Editor, STAGING project (wieflwbfdmjtsdnwbfii) first.
-- Safe to re-run: every DDL statement is defensive (IF NOT EXISTS / guarded).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. message_templates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    name            text NOT NULL,
    template_type   text NOT NULL CHECK (template_type IN ('marketing', 'transactional')),
    channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
    subject         text,                 -- email only, nullable for sms-only templates
    body_email      text,                 -- nullable for sms-only templates
    body_sms        text,                 -- nullable for email-only templates
    variables       jsonb NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["customer_name","amount"]
    is_active       boolean NOT NULL DEFAULT true,
    created_by      uuid REFERENCES user_accounts(auth_uid),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT message_templates_channel_content_chk CHECK (
        (channel = 'email' AND body_email IS NOT NULL) OR
        (channel = 'sms'   AND body_sms   IS NOT NULL) OR
        (channel = 'both'  AND body_email IS NOT NULL AND body_sms IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_message_templates_tenant ON message_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_type ON message_templates(tenant_id, template_type);

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_templates_tenant_all ON message_templates;
CREATE POLICY message_templates_tenant_all ON message_templates
    FOR ALL
    USING (tenant_matches(tenant_id))
    WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 2. customer_comm_preferences
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_comm_preferences (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    customer_id         text NOT NULL,
    email_opt_in        boolean NOT NULL DEFAULT true,
    sms_opt_in          boolean NOT NULL DEFAULT true,
    unsubscribed_at     timestamptz,
    unsubscribe_token   uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT customer_comm_preferences_unique_customer UNIQUE (tenant_id, customer_id),
    CONSTRAINT customer_comm_preferences_customer_fkey FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_comm_prefs_tenant ON customer_comm_preferences(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_comm_prefs_unsub_token ON customer_comm_preferences(unsubscribe_token);

ALTER TABLE customer_comm_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_comm_preferences_tenant_all ON customer_comm_preferences;
CREATE POLICY customer_comm_preferences_tenant_all ON customer_comm_preferences
    FOR ALL
    USING (tenant_matches(tenant_id))
    WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 3. campaigns
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id),
    campaign_code       text,                 -- auto-generated via generate_next_code(tenant_id,'CAMP',4) on save
    name                text NOT NULL,
    template_id         uuid NOT NULL REFERENCES message_templates(id),
    channel             text NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
    audience_filter     jsonb NOT NULL DEFAULT '{"type":"all"}'::jsonb,
    status              text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
    scheduled_at        timestamptz,
    sent_at             timestamptz,
    total_recipients     integer NOT NULL DEFAULT 0,
    created_by          uuid REFERENCES user_accounts(auth_uid),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code ON campaigns(tenant_id, campaign_code) WHERE campaign_code IS NOT NULL;

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_tenant_all ON campaigns;
CREATE POLICY campaigns_tenant_all ON campaigns
    FOR ALL
    USING (tenant_matches(tenant_id))
    WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 4. campaign_recipients
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_id     text NOT NULL,
    channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'skipped_opted_out')),
    provider_ref    text,       -- Resend message id / Hubtel message id
    error           text,
    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT campaign_recipients_customer_fkey FOREIGN KEY (tenant_id, customer_id)
        REFERENCES customers(tenant_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_tenant ON campaign_recipients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON campaign_recipients(campaign_id, status);

ALTER TABLE campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_recipients_tenant_all ON campaign_recipients;
CREATE POLICY campaign_recipients_tenant_all ON campaign_recipients
    FOR ALL
    USING (tenant_matches(tenant_id))
    WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 5. transactional_notification_rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactional_notification_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id),
    event_type      text NOT NULL,       -- e.g. 'sale_completed', 'payment_received', 'invoice_created'
    template_id     uuid NOT NULL REFERENCES message_templates(id),
    channel         text NOT NULL CHECK (channel IN ('email', 'sms', 'both')),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT transactional_notification_rules_unique_event UNIQUE (tenant_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_txn_notif_rules_tenant ON transactional_notification_rules(tenant_id);

ALTER TABLE transactional_notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transactional_notification_rules_tenant_all ON transactional_notification_rules;
CREATE POLICY transactional_notification_rules_tenant_all ON transactional_notification_rules
    FOR ALL
    USING (tenant_matches(tenant_id))
    WITH CHECK (tenant_matches(tenant_id));

COMMIT;

-- ============================================================================
-- VERIFICATION — run after commit, in a NEW SQL Editor tab.
-- Combined into ONE query (Supabase's editor only shows the last statement's
-- result when several are run together) — one result set, multiple rows.
-- ============================================================================

SELECT 'table_rls_enabled' AS check_name,
       c.relname || ' = ' || c.relrowsecurity::text AS result
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
      'message_templates', 'customer_comm_preferences', 'campaigns',
      'campaign_recipients', 'transactional_notification_rules'
  )

UNION ALL

SELECT 'rls_policy',
       tablename || ' | ' || policyname || ' | USING: ' || qual || ' | CHECK: ' || with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'message_templates', 'customer_comm_preferences', 'campaigns',
      'campaign_recipients', 'transactional_notification_rules'
  )

UNION ALL

SELECT 'row_count', 'message_templates = ' || count(*)::text FROM message_templates
UNION ALL
SELECT 'row_count', 'customer_comm_preferences = ' || count(*)::text FROM customer_comm_preferences
UNION ALL
SELECT 'row_count', 'campaigns = ' || count(*)::text FROM campaigns
UNION ALL
SELECT 'row_count', 'campaign_recipients = ' || count(*)::text FROM campaign_recipients
UNION ALL
SELECT 'row_count', 'transactional_notification_rules = ' || count(*)::text FROM transactional_notification_rules

ORDER BY check_name;
