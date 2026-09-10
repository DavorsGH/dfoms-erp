-- Script 294: Referral rewards, account credit ledger, custom subscription pricing.
-- Apply on staging first; production after verification.
--
-- Adds:
--   account_credit_ledger, referral_codes, referrals
--   crm_subscriptions custom price override columns
--   platform_billing_config.referral_reward_ghs seed row
--   apply_account_credit(), grant_post_waiver_grace_period()

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Account credit ledger + billing_settings.credit_balance guard
-- ----------------------------------------------------------------------------
ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS credit_balance numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.billing_settings
  DROP CONSTRAINT IF EXISTS billing_settings_credit_balance_nonneg;

ALTER TABLE public.billing_settings
  ADD CONSTRAINT billing_settings_credit_balance_nonneg
  CHECK (credit_balance >= 0);

CREATE TABLE IF NOT EXISTS public.account_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  delta_ghs numeric(12, 2) NOT NULL,
  reason text NOT NULL CHECK (
    reason IN (
      'referral_reward',
      'subscription_payment',
      'sms_purchase',
      'adjustment'
    )
  ),
  reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_credit_ledger_tenant_created_idx
  ON public.account_credit_ledger (tenant_id, created_at DESC);

COMMENT ON TABLE public.account_credit_ledger IS
  'Immutable audit ledger for billing_settings.credit_balance mutations. '
  'Positive delta = credit added; negative delta = credit applied to a charge.';

-- ----------------------------------------------------------------------------
-- 2. Referral codes + referrals
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_codes_code_lower_idx
  ON public.referral_codes (lower(code));

COMMENT ON TABLE public.referral_codes IS
  'One referral code per ERP tenant, auto-created at signup.';

CREATE TABLE IF NOT EXISTS public.referrals (
  referred_tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  referrer_tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'rewarded', 'expired')),
  reward_amount_ghs numeric(12, 2) NOT NULL CHECK (reward_amount_ghs >= 0),
  qualified_at timestamptz NULL,
  rewarded_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self_referral
    CHECK (referrer_tenant_id <> referred_tenant_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_status_idx
  ON public.referrals (referrer_tenant_id, status);

COMMENT ON TABLE public.referrals IS
  'Referral capture at signup; reward_amount_ghs is snapshotted from '
  'platform_billing_config.referral_reward_ghs at capture time.';

-- ----------------------------------------------------------------------------
-- 3. Custom subscription price override (Davors staff)
-- ----------------------------------------------------------------------------
ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_ghs numeric(12, 2) NULL;

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_reason text NULL;

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_set_by text NULL;

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_set_at timestamptz NULL;

ALTER TABLE public.crm_subscriptions
  DROP CONSTRAINT IF EXISTS crm_subscriptions_custom_price_ghs_nonneg;

ALTER TABLE public.crm_subscriptions
  ADD CONSTRAINT crm_subscriptions_custom_price_ghs_nonneg
  CHECK (custom_price_ghs IS NULL OR custom_price_ghs >= 0);

COMMENT ON COLUMN public.crm_subscriptions.custom_price_ghs IS
  'Optional per-tenant subscription checkout override (GHS). When set, '
  'replaces crm_products.price_ghs for Paystack checkout/renewal amount.';

-- ----------------------------------------------------------------------------
-- 4. Referral reward config (editable via Platform Unit Pricing admin UI)
-- ----------------------------------------------------------------------------
INSERT INTO public.platform_billing_config (config_key, price_ghs)
VALUES ('referral_reward_ghs', 25.00)
ON CONFLICT (config_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. apply_account_credit()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_account_credit(
  p_tenant_id uuid,
  p_delta_ghs numeric,
  p_reason text,
  p_reference text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current numeric(12, 2);
  v_new numeric(12, 2);
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_delta_ghs IS NULL OR p_delta_ghs = 0 THEN
    RAISE EXCEPTION 'delta_ghs must be non-zero';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  IF p_reason NOT IN (
    'referral_reward',
    'subscription_payment',
    'sms_purchase',
    'adjustment'
  ) THEN
    RAISE EXCEPTION 'invalid reason: %', p_reason;
  END IF;

  INSERT INTO public.billing_settings (tenant_id, credit_balance)
  VALUES (p_tenant_id, 0)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT credit_balance
  INTO v_current
  FROM public.billing_settings
  WHERE tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'billing_settings row missing for tenant %', p_tenant_id;
  END IF;

  v_new := round((v_current + p_delta_ghs)::numeric, 2);

  IF v_new < 0 THEN
    RAISE EXCEPTION
      'insufficient credit balance (current %, delta %)',
      v_current,
      p_delta_ghs;
  END IF;

  UPDATE public.billing_settings
  SET credit_balance = v_new
  WHERE tenant_id = p_tenant_id;

  INSERT INTO public.account_credit_ledger (
    tenant_id,
    delta_ghs,
    reason,
    reference
  )
  VALUES (
    p_tenant_id,
    round(p_delta_ghs::numeric, 2),
    p_reason,
    NULLIF(btrim(p_reference), '')
  );

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_account_credit(uuid, numeric, text, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_account_credit(uuid, numeric, text, text, uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 6. grant_post_waiver_grace_period()
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_post_waiver_grace_period(
  p_tenant_id uuid,
  p_grace_days integer DEFAULT 14
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_current_trial_end date;
  v_new_trial_end date;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'grace_days must be a non-negative integer';
  END IF;

  SELECT id, trial_end_date::date
  INTO v_subscription_id, v_current_trial_end
  FROM public.crm_subscriptions
  WHERE linked_tenant_id = p_tenant_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'no crm_subscriptions row for linked tenant %', p_tenant_id;
  END IF;

  v_new_trial_end := GREATEST(
    COALESCE(v_current_trial_end, CURRENT_DATE),
    CURRENT_DATE
  ) + make_interval(days => p_grace_days);

  UPDATE public.crm_subscriptions
  SET trial_end_date = v_new_trial_end
  WHERE id = v_subscription_id;

  RETURN v_new_trial_end::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_post_waiver_grace_period(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_post_waiver_grace_period(uuid, integer)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 7. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.account_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_credit_ledger_tenant_select ON public.account_credit_ledger;
CREATE POLICY account_credit_ledger_tenant_select
  ON public.account_credit_ledger
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS referral_codes_tenant_select ON public.referral_codes;
CREATE POLICY referral_codes_tenant_select
  ON public.referral_codes
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS referrals_referrer_select ON public.referrals;
CREATE POLICY referrals_referrer_select
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (tenant_matches(referrer_tenant_id));

COMMIT;
