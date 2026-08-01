-- ============================================================================
-- 123_sms_credit_system.sql
-- Davors ERP Suite - Prepaid SMS Credit Wallet System
--
-- Enterprise tenants get a monthly bundled SMS allowance (default 50/month,
-- reset lazily at send time - no cron infra exists in this project). Beyond
-- that, SMS is prepaid credits topped up via a one-off Paystack charge,
-- mirroring the existing product_sale_payment_requests pattern (no
-- subaccount - this charge settles to Davors, not the tenant).
--
-- Requires 121_tier_entitlement_system.sql and 122_tier_rls_policies.sql to
-- already be applied (tenant_has_feature(), tier_slug).
--
-- Run on STAGING first. Do not run on production until staging is verified.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Credit pack pricing (editable reference table, same spirit as
--    crm_products.price_ghs being editable via Tier Pricing)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_credit_packs (
  pack_key    text PRIMARY KEY,
  credits     integer NOT NULL CHECK (credits > 0),
  price_ghs   numeric(12,2) NOT NULL CHECK (price_ghs > 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sms_credit_packs (pack_key, credits, price_ghs) VALUES
  ('pack_100',  100,  10.00),
  ('pack_500',  500,  45.00),
  ('pack_1000', 1000, 80.00)
ON CONFLICT (pack_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Wallet (one row per tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_credit_wallets (
  tenant_id             uuid PRIMARY KEY REFERENCES tenants(id),
  balance               integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  allowance_per_cycle   integer NOT NULL DEFAULT 50,
  last_allowance_reset_at timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Immutable audit ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_credit_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  delta       integer NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('purchase', 'send', 'monthly_allowance_reset', 'adjustment')),
  reference   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_transactions_tenant ON sms_credit_transactions(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Purchase request ledger - mirrors product_sale_payment_requests exactly
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sms_credit_purchase_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  pack_key            text NOT NULL REFERENCES sms_credit_packs(pack_key),
  credits_requested   integer NOT NULL,
  amount_requested_ghs numeric(12,2) NOT NULL,
  paystack_reference  text UNIQUE,
  authorization_url   text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'paid', 'failed', 'cancelled')),
  paid_amount_ghs     numeric(12,2),
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_purchase_requests_tenant ON sms_credit_purchase_requests(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE sms_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_credit_purchase_requests ENABLE ROW LEVEL SECURITY;

-- Wallet: tenant can only SELECT their own balance - all mutation happens via
-- service-role code paths (webhook credits, send-time debits, allowance reset),
-- never directly from the tenant's own session.
CREATE POLICY sms_credit_wallets_tenant_select ON sms_credit_wallets
  FOR SELECT
  USING (tenant_matches(tenant_id));

-- Transactions: tenant can SELECT their own history only, never write directly.
CREATE POLICY sms_credit_transactions_tenant_select ON sms_credit_transactions
  FOR SELECT
  USING (tenant_matches(tenant_id));

-- Purchase requests: standard tenant CRUD (matching product_sale_payment_requests).
-- ANY tier can purchase SMS credits (SMS is now separately monetized per-credit,
-- so there's no reason to restrict purchasing to Enterprise) - only the FREE
-- monthly bundled allowance (ensure_sms_allowance_current, below) stays an
-- Enterprise-exclusive perk.
CREATE POLICY sms_credit_purchase_requests_tenant_select ON sms_credit_purchase_requests
  FOR SELECT
  USING (tenant_matches(tenant_id));
CREATE POLICY sms_credit_purchase_requests_tenant_insert ON sms_credit_purchase_requests
  FOR INSERT
  WITH CHECK (tenant_matches(tenant_id));
CREATE POLICY sms_credit_purchase_requests_tenant_update ON sms_credit_purchase_requests
  FOR UPDATE
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 6. Functions
-- ----------------------------------------------------------------------------

-- Lazily resets the Enterprise monthly SMS allowance if >30 days have passed
-- since the last reset (no cron infra exists in this project - checked at
-- send time instead of on a schedule). No-op for non-Enterprise tenants or
-- tenants with no wallet row yet (created on first use/purchase).
CREATE OR REPLACE FUNCTION ensure_sms_allowance_current(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet sms_credit_wallets%ROWTYPE;
BEGIN
  IF NOT tenant_has_feature(p_tenant_id, 'email_promotions') THEN
    RETURN;
  END IF;

  INSERT INTO sms_credit_wallets (tenant_id, balance, last_allowance_reset_at)
  VALUES (p_tenant_id, 0, NULL)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_wallet FROM sms_credit_wallets WHERE tenant_id = p_tenant_id;

  IF v_wallet.last_allowance_reset_at IS NULL OR v_wallet.last_allowance_reset_at < (now() - interval '30 days') THEN
    UPDATE sms_credit_wallets
    SET balance = balance + v_wallet.allowance_per_cycle,
        last_allowance_reset_at = now(),
        updated_at = now()
    WHERE tenant_id = p_tenant_id;

    INSERT INTO sms_credit_transactions (tenant_id, delta, reason, reference)
    VALUES (p_tenant_id, v_wallet.allowance_per_cycle, 'monthly_allowance_reset', NULL);
  END IF;
END;
$$;

-- Atomically debits 1 credit if the tenant has a positive balance. Returns
-- true if debited (send should proceed as SMS), false if the wallet is empty
-- (caller should fall back to email-only, not fail the notification).
CREATE OR REPLACE FUNCTION debit_sms_credit(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  PERFORM ensure_sms_allowance_current(p_tenant_id);

  UPDATE sms_credit_wallets
  SET balance = balance - 1,
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND balance > 0
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO sms_credit_transactions (tenant_id, delta, reason, reference)
  VALUES (p_tenant_id, -1, 'send', NULL);

  RETURN true;
END;
$$;

-- Credits a wallet after a confirmed Paystack purchase (called from the
-- webhook handler, service-role context). Idempotency is the webhook's
-- responsibility (paystack_webhook_events + row status='paid' check) -
-- this function itself is not idempotent and must only be called once
-- per confirmed payment.
CREATE OR REPLACE FUNCTION credit_sms_purchase(p_tenant_id uuid, p_credits integer, p_reference text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO sms_credit_wallets (tenant_id, balance, last_allowance_reset_at)
  VALUES (p_tenant_id, 0, NULL)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE sms_credit_wallets
  SET balance = balance + p_credits,
      updated_at = now()
  WHERE tenant_id = p_tenant_id;

  INSERT INTO sms_credit_transactions (tenant_id, delta, reason, reference)
  VALUES (p_tenant_id, p_credits, 'purchase', p_reference);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Lock SECURITY DEFINER RPCs to service_role only
--    Pattern: REVOKE ALL FROM PUBLIC/anon/authenticated (scripts 130 + 137),
--    then GRANT EXECUTE only to service_role.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.ensure_sms_allowance_current(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_sms_allowance_current(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_sms_allowance_current(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_sms_allowance_current(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.debit_sms_credit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_sms_credit(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.debit_sms_credit(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.debit_sms_credit(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.credit_sms_purchase(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_sms_purchase(uuid, integer, text) FROM anon;
REVOKE ALL ON FUNCTION public.credit_sms_purchase(uuid, integer, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_sms_purchase(uuid, integer, text) TO service_role;

-- ----------------------------------------------------------------------------
-- Verification (single combined query)
-- ----------------------------------------------------------------------------
SELECT 'sms_credit_packs row count' AS check_name, (SELECT count(*)::text FROM sms_credit_packs)
UNION ALL
SELECT 'pack pricing', (SELECT string_agg(pack_key || '=' || credits || '/GH₵' || price_ghs, ', ') FROM sms_credit_packs)
UNION ALL
SELECT 'functions exist', (SELECT count(*)::text FROM pg_proc WHERE proname IN ('ensure_sms_allowance_current', 'debit_sms_credit', 'credit_sms_purchase'))
UNION ALL
SELECT 'RLS enabled on all 3 tables', (
  SELECT count(*)::text FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.tablename IN ('sms_credit_wallets', 'sms_credit_transactions', 'sms_credit_purchase_requests')
  AND c.relrowsecurity = true
)
UNION ALL
SELECT 'debit_sms_credit on unknown tenant (expect false, no wallet row created)', (
  SELECT debit_sms_credit('00000000-0000-0000-0000-000000000000'::uuid)::text
)
UNION ALL
SELECT 'wallet rows created by the check above (expect 0 - fail-closed, no FK violation)', (
  SELECT count(*)::text FROM sms_credit_wallets WHERE tenant_id = '00000000-0000-0000-0000-000000000000'::uuid
);

-- For a real end-to-end test once a specific staging tenant is chosen (e.g.
-- Caanta once upgraded to Enterprise for testing), run separately:
--   SELECT credit_sms_purchase('<tenant_id>'::uuid, 100, 'test-manual-credit');
--   SELECT balance FROM sms_credit_wallets WHERE tenant_id = '<tenant_id>'::uuid;
--   SELECT debit_sms_credit('<tenant_id>'::uuid);
--   SELECT balance FROM sms_credit_wallets WHERE tenant_id = '<tenant_id>'::uuid;
-- (Not run here automatically to avoid leaving test credit balances on a real tenant.)
