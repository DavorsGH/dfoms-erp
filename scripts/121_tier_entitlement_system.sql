-- ============================================================================
-- 121_tier_entitlement_system.sql
-- Davors ERP Suite - Tier-Based Feature Entitlement System
--
-- Adds:
--   1. crm_products.tier_slug - normalized tier identity (starter/professional/
--      business/enterprise), backfilled from the existing `name` field, so
--      entitlement logic never has to substring-parse a display name.
--   2. tier_features - static tier -> feature_key mapping table.
--   3. tenant_has_feature(p_tenant_id, p_feature_key) - single source of truth
--      entitlement resolver, usable in both RLS policies and server-side code.
--
-- Run on STAGING first. Do not run on production until staging is verified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Normalize tier identity on crm_products
-- ----------------------------------------------------------------------------
ALTER TABLE crm_products
  ADD COLUMN IF NOT EXISTS tier_slug text
  CHECK (tier_slug IN ('starter', 'professional', 'business', 'enterprise'));

-- Backfill from the existing `name` field (only touches ERP Suite catalog rows;
-- any other product_type/category rows are left untouched with tier_slug NULL).
UPDATE crm_products
SET tier_slug = 'starter'
WHERE category = 'ERP Suite' AND name ILIKE '%Starter%' AND tier_slug IS NULL;

UPDATE crm_products
SET tier_slug = 'professional'
WHERE category = 'ERP Suite' AND name ILIKE '%Professional%' AND tier_slug IS NULL;

UPDATE crm_products
SET tier_slug = 'business'
WHERE category = 'ERP Suite' AND name ILIKE '%Business%' AND tier_slug IS NULL;

UPDATE crm_products
SET tier_slug = 'enterprise'
WHERE category = 'ERP Suite' AND name ILIKE '%Enterprise%' AND tier_slug IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Tier -> feature mapping (static reference table)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tier_features (
  tier_slug   text NOT NULL CHECK (tier_slug IN ('starter', 'professional', 'business', 'enterprise')),
  feature_key text NOT NULL,
  PRIMARY KEY (tier_slug, feature_key)
);

-- Starter intentionally has no rows here - it gets Finance + HR & Payroll +
-- Administration, none of which are gated (see design notes below).
INSERT INTO tier_features (tier_slug, feature_key) VALUES
  ('professional', 'operations'),
  ('professional', 'crm_core'),
  ('business',     'operations'),
  ('business',     'crm_core'),
  ('business',     'pos'),
  ('business',     'inventory'),
  ('enterprise',   'operations'),
  ('enterprise',   'crm_core'),
  ('enterprise',   'pos'),
  ('enterprise',   'inventory'),
  ('enterprise',   'email_promotions')
ON CONFLICT (tier_slug, feature_key) DO NOTHING;

-- Feature key reference (for anyone reading this script later):
--   operations        - all Operations tabs, Incidents Reports, Customer-Facing Reports
--   crm_core          - Customer List, Product Catalog, Product Sales, Sales Log, Sales Reports
--   pos               - POS
--   inventory         - Finished Products, Raw Materials, Production Batches,
--                        Internal Consumption, Supplier Management/Purchasing, Inventory Reports
--   email_promotions  - Email & Promotions (Templates/Campaigns/Notification Rules)
-- Not gated at all (Starter-level, every tier has it): Finance, HR & Payroll
-- (incl. Salary Settings/Leave Entitlement Policy), Finance/HR Reports,
-- Administration (all of it).

-- ----------------------------------------------------------------------------
-- 3. Entitlement resolver function
-- ----------------------------------------------------------------------------
-- IMPORTANT: this app's Davors platform tenant is fixed at
-- 00000001-0000-4000-8000-000000000001 - always gets full access (it is not
-- a paying customer of its own product).
--
-- Resolution order mirrors ensureTrialAccess's existing pattern:
--   1. Davors platform tenant -> full access
--   2. No subscription row found -> no access (shouldn't reach a gated page
--      at all, since ensureTrialAccess would already have blocked it, but
--      fail closed just in case)
--   3. billing_waived -> full access (matches existing comp-a-tenant pattern)
--   4. Valid trial (status = 'trialing' AND trial_end_date not passed, or
--      null) -> full access (edge-case decision: trial = full platform)
--   5. tier_slug resolved from product_id -> check tier_features
--   6. No tier_slug yet (trial expired with no plan chosen) -> no access
CREATE OR REPLACE FUNCTION tenant_has_feature(p_tenant_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_status          text;
  v_trial_end       timestamptz;
  v_billing_waived  boolean;
  v_tier_slug       text;
BEGIN
  IF p_tenant_id = '00000001-0000-4000-8000-000000000001'::uuid THEN
    RETURN true;
  END IF;

  SELECT s.subscription_status, s.trial_end_date, s.billing_waived, p.tier_slug
  INTO v_status, v_trial_end, v_billing_waived, v_tier_slug
  FROM crm_subscriptions s
  LEFT JOIN crm_products p ON p.id = s.product_id
  WHERE s.linked_tenant_id = p_tenant_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_billing_waived THEN
    RETURN true;
  END IF;

  IF v_status = 'trialing' AND (v_trial_end IS NULL OR v_trial_end >= now()) THEN
    RETURN true;
  END IF;

  IF v_tier_slug IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM tier_features tf
    WHERE tf.tier_slug = v_tier_slug AND tf.feature_key = p_feature_key
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- Verification (single combined query - Supabase SQL Editor only shows the
-- last statement's result when multiple SELECTs are run together)
-- ----------------------------------------------------------------------------
SELECT 'tier_slug backfill' AS check_name,
       (SELECT count(*)::text FROM crm_products WHERE category = 'ERP Suite' AND tier_slug IS NULL) AS detail
UNION ALL
SELECT 'tier_slug distribution',
       (SELECT string_agg(tier_slug || '=' || cnt::text, ', ')
        FROM (SELECT tier_slug, count(*) cnt FROM crm_products WHERE category = 'ERP Suite' GROUP BY tier_slug) t)
UNION ALL
SELECT 'tier_features row count',
       (SELECT count(*)::text FROM tier_features)
UNION ALL
SELECT 'function exists',
       (SELECT count(*)::text FROM pg_proc WHERE proname = 'tenant_has_feature')
UNION ALL
SELECT 'sample: Davors tenant always true',
       tenant_has_feature('00000001-0000-4000-8000-000000000001'::uuid, 'operations')::text
UNION ALL
SELECT 'sample: unknown/random tenant on operations (expect false)',
       tenant_has_feature('00000000-0000-0000-0000-000000000000'::uuid, 'operations')::text;
