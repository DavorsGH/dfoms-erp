-- Align landlord_subscriptions with platform_only billing code paths.
-- Apply after 220_landlord_subscriptions_annual_billing.sql on staging/production.
--
-- Staging/prod table uses composite PK (tenant_id, subscription_id) and stricter
-- NOT NULL columns than the simplified CREATE IF NOT EXISTS in script 220.

-- platform_only trial rows use tier = 'platform' in application code.
ALTER TABLE public.landlord_subscriptions
  DROP CONSTRAINT IF EXISTS landlord_subscriptions_tier_check;

ALTER TABLE public.landlord_subscriptions
  ADD CONSTRAINT landlord_subscriptions_tier_check
  CHECK (tier IN ('base', 'growth', 'pro', 'platform'));

-- One active subscription row per landlord tenant (billing code updates by tenant_id).
CREATE UNIQUE INDEX IF NOT EXISTS landlord_subscriptions_tenant_id_unique
  ON public.landlord_subscriptions (tenant_id);
