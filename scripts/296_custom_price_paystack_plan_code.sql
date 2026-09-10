-- 296_custom_price_paystack_plan_code.sql
-- Dedicated Paystack plan per custom-priced ERP Suite subscription (recurring renewals).

BEGIN;

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS custom_price_paystack_plan_code text NULL;

COMMENT ON COLUMN public.crm_subscriptions.custom_price_paystack_plan_code IS
  'Paystack plan code for this tenant''s custom subscription price. Created/updated '
  'when Davors staff sets custom_price_ghs. Left in place when override is cleared.';

COMMIT;
