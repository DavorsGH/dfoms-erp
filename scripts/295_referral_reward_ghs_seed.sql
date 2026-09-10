-- Script 295: Ensure platform_billing_config.referral_reward_ghs seed row exists.
-- Safe to re-run: inserts only when missing (does not overwrite admin edits).
-- Apply on staging/production if 294 ran before this seed was present.

BEGIN;

INSERT INTO public.platform_billing_config (config_key, price_ghs)
VALUES ('referral_reward_ghs', 25.00)
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
