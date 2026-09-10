-- 297_custom_price_tier_lock.sql
-- Lock custom subscription pricing to the tier active when staff set the override.

BEGIN;

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_tier_product_id uuid NULL
    REFERENCES public.crm_products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.crm_subscriptions.custom_price_tier_product_id IS
  'CRM product (tier) the custom_price_ghs override applies to. Set when staff saves '
  'a custom price; cleared when override is removed or auto-cleared on tier switch checkout.';

COMMIT;
