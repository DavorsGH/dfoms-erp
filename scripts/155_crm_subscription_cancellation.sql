-- 155_crm_subscription_cancellation.sql
-- Churn tracking + Paystack email token for subscription disable API.
-- Apply on staging/production before using Billing Settings → Cancel Subscription.

ALTER TABLE public.crm_subscriptions
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_reason_detail text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS paystack_email_token text;

COMMENT ON COLUMN public.crm_subscriptions.cancellation_reason IS
  'Churn reason slug when tenant cancels via Billing Settings (too_expensive, missing_features, switching_tool, no_longer_needed, other).';

COMMENT ON COLUMN public.crm_subscriptions.cancellation_reason_detail IS
  'Free-text detail when cancellation_reason = other.';

COMMENT ON COLUMN public.crm_subscriptions.cancelled_at IS
  'When cancellation was requested (manual or recorded). Access may continue until next_billing_date.';

COMMENT ON COLUMN public.crm_subscriptions.paystack_email_token IS
  'Paystack subscription email_token required for disable/enable API; captured from webhooks when available.';
