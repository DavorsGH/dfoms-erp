ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;

ALTER TABLE public.landlord_subscriptions
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
