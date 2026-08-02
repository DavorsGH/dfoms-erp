-- ============================================================================
-- 123b_sms_credit_system_idempotent.sql
-- Davors ERP Suite - Prepaid SMS Credit Wallet System (safe re-run)
--
-- Idempotent revision of scripts/123_sms_credit_system.sql.
-- Desired end state (matches staging / original 123):
--   - 4 tables: sms_credit_packs, sms_credit_wallets,
--               sms_credit_transactions, sms_credit_purchase_requests
--   - 3 packs: pack_100/100/10, pack_500/500/45, pack_1000/1000/80
--   - RLS on wallets / transactions / purchase_requests + 5 tenant policies
--   - 3 SECURITY DEFINER functions
--   - EXECUTE locked to service_role only (REVOKE PUBLIC/anon/authenticated)
--
-- Safe to re-run:
--   CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
--   INSERT ... ON CONFLICT DO NOTHING
--   DROP POLICY IF EXISTS before CREATE POLICY
--   CREATE OR REPLACE FUNCTION
--   REVOKE / GRANT (idempotent)
--
-- Verification is read-only (does NOT call debit_sms_credit / credit_sms_purchase).
--
-- NOT APPLIED. Review before running. Staging first if anything is still missing.
-- Requires 121_tier_entitlement_system.sql and 122_tier_rls_policies.sql.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Credit pack pricing
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_credit_packs (
  pack_key    text PRIMARY KEY,
  credits     integer NOT NULL CHECK (credits > 0),
  price_ghs   numeric(12,2) NOT NULL CHECK (price_ghs > 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sms_credit_packs (pack_key, credits, price_ghs) VALUES
  ('pack_100',  100,  10.00),
  ('pack_500',  500,  45.00),
  ('pack_1000', 1000, 80.00)
ON CONFLICT (pack_key) DO UPDATE
SET credits = EXCLUDED.credits,
    price_ghs = EXCLUDED.price_ghs,
    is_active = true;

-- ----------------------------------------------------------------------------
-- 2. Wallet (one row per tenant)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_credit_wallets (
  tenant_id               uuid PRIMARY KEY REFERENCES public.tenants(id),
  balance                 integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  allowance_per_cycle     integer NOT NULL DEFAULT 50,
  last_allowance_reset_at timestamptz,
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Immutable audit ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_credit_transactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id),
  delta       integer NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('purchase', 'send', 'monthly_allowance_reset', 'adjustment')),
  reference   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_transactions_tenant
  ON public.sms_credit_transactions(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. Purchase request ledger
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_credit_purchase_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id),
  pack_key             text NOT NULL REFERENCES public.sms_credit_packs(pack_key),
  credits_requested    integer NOT NULL,
  amount_requested_ghs numeric(12,2) NOT NULL,
  paystack_reference   text UNIQUE,
  authorization_url    text,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'paid', 'failed', 'cancelled')),
  paid_amount_ghs      numeric(12,2),
  paid_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_purchase_requests_tenant
  ON public.sms_credit_purchase_requests(tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. RLS (DROP IF EXISTS so re-runs do not fail on existing policy names)
-- ----------------------------------------------------------------------------
ALTER TABLE public.sms_credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_credit_purchase_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sms_credit_wallets_tenant_select
  ON public.sms_credit_wallets;
CREATE POLICY sms_credit_wallets_tenant_select
  ON public.sms_credit_wallets
  FOR SELECT
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS sms_credit_transactions_tenant_select
  ON public.sms_credit_transactions;
CREATE POLICY sms_credit_transactions_tenant_select
  ON public.sms_credit_transactions
  FOR SELECT
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS sms_credit_purchase_requests_tenant_select
  ON public.sms_credit_purchase_requests;
CREATE POLICY sms_credit_purchase_requests_tenant_select
  ON public.sms_credit_purchase_requests
  FOR SELECT
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS sms_credit_purchase_requests_tenant_insert
  ON public.sms_credit_purchase_requests;
CREATE POLICY sms_credit_purchase_requests_tenant_insert
  ON public.sms_credit_purchase_requests
  FOR INSERT
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS sms_credit_purchase_requests_tenant_update
  ON public.sms_credit_purchase_requests;
CREATE POLICY sms_credit_purchase_requests_tenant_update
  ON public.sms_credit_purchase_requests
  FOR UPDATE
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

-- ----------------------------------------------------------------------------
-- 6. Functions (CREATE OR REPLACE)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_sms_allowance_current(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_wallet public.sms_credit_wallets%ROWTYPE;
BEGIN
  IF NOT tenant_has_feature(p_tenant_id, 'email_promotions') THEN
    RETURN;
  END IF;

  INSERT INTO public.sms_credit_wallets (tenant_id, balance, last_allowance_reset_at)
  VALUES (p_tenant_id, 0, NULL)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_wallet FROM public.sms_credit_wallets WHERE tenant_id = p_tenant_id;

  IF v_wallet.last_allowance_reset_at IS NULL
     OR v_wallet.last_allowance_reset_at < (now() - interval '30 days') THEN
    UPDATE public.sms_credit_wallets
    SET balance = balance + v_wallet.allowance_per_cycle,
        last_allowance_reset_at = now(),
        updated_at = now()
    WHERE tenant_id = p_tenant_id;

    INSERT INTO public.sms_credit_transactions (tenant_id, delta, reason, reference)
    VALUES (p_tenant_id, v_wallet.allowance_per_cycle, 'monthly_allowance_reset', NULL);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_sms_credit(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  PERFORM public.ensure_sms_allowance_current(p_tenant_id);

  UPDATE public.sms_credit_wallets
  SET balance = balance - 1,
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND balance > 0
  RETURNING balance INTO v_new_balance;

  IF v_new_balance IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.sms_credit_transactions (tenant_id, delta, reason, reference)
  VALUES (p_tenant_id, -1, 'send', NULL);

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_sms_purchase(
  p_tenant_id uuid,
  p_credits integer,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.sms_credit_wallets (tenant_id, balance, last_allowance_reset_at)
  VALUES (p_tenant_id, 0, NULL)
  ON CONFLICT (tenant_id) DO NOTHING;

  UPDATE public.sms_credit_wallets
  SET balance = balance + p_credits,
      updated_at = now()
  WHERE tenant_id = p_tenant_id;

  INSERT INTO public.sms_credit_transactions (tenant_id, delta, reason, reference)
  VALUES (p_tenant_id, p_credits, 'purchase', p_reference);
END;
$$;

-- ----------------------------------------------------------------------------
-- 7. Lock SECURITY DEFINER RPCs to service_role only
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
-- 8. Read-only verification (no mutating RPC calls)
-- ----------------------------------------------------------------------------
SELECT 'sms_credit_packs row count' AS check_name,
       (SELECT count(*)::text FROM public.sms_credit_packs)
UNION ALL
SELECT 'pack pricing',
       (SELECT string_agg(pack_key || '=' || credits || '/GH₵' || price_ghs, ', ' ORDER BY credits)
        FROM public.sms_credit_packs)
UNION ALL
SELECT 'tables exist',
       (SELECT count(*)::text FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'sms_credit_packs',
            'sms_credit_wallets',
            'sms_credit_transactions',
            'sms_credit_purchase_requests'
          ))
UNION ALL
SELECT 'functions exist',
       (SELECT count(*)::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'ensure_sms_allowance_current',
            'debit_sms_credit',
            'credit_sms_purchase'
          ))
UNION ALL
SELECT 'RLS enabled on wallet tables',
       (SELECT count(*)::text FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN (
            'sms_credit_wallets',
            'sms_credit_transactions',
            'sms_credit_purchase_requests'
          )
          AND c.relrowsecurity = true)
UNION ALL
SELECT 'expected policies present',
       (SELECT count(*)::text FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname IN (
            'sms_credit_wallets_tenant_select',
            'sms_credit_transactions_tenant_select',
            'sms_credit_purchase_requests_tenant_select',
            'sms_credit_purchase_requests_tenant_insert',
            'sms_credit_purchase_requests_tenant_update'
          ))
UNION ALL
SELECT 'service_role can EXECUTE all 3',
       (SELECT count(*)::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'ensure_sms_allowance_current',
            'debit_sms_credit',
            'credit_sms_purchase'
          )
          AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
UNION ALL
SELECT 'anon cannot EXECUTE any of 3',
       (SELECT count(*)::text FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'ensure_sms_allowance_current',
            'debit_sms_credit',
            'credit_sms_purchase'
          )
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'));

COMMIT;

-- Expected verification row values after a successful apply:
--   sms_credit_packs row count          >= 3
--   pack pricing                        pack_100=100/GH₵10.00, pack_500=500/GH₵45.00, pack_1000=1000/GH₵80.00
--   tables exist                        4
--   functions exist                     3
--   RLS enabled on wallet tables        3
--   expected policies present           5
--   service_role can EXECUTE all 3      3
--   anon cannot EXECUTE any of 3        3
