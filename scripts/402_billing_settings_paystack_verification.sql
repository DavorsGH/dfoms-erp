-- R58: Persist Paystack settlement subaccount verification on billing_settings.
-- Used by Online Payments UI, MoMo readiness (POS / sales), and nightly reconciliation.

ALTER TABLE public.billing_settings
  ADD COLUMN IF NOT EXISTS paystack_subaccount_verified_ok boolean,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS paystack_subaccount_last_verify_error text;

COMMENT ON COLUMN public.billing_settings.paystack_subaccount_verified_ok IS
  'True when Paystack returned the settlement subaccount successfully; false on fetch/error.';
COMMENT ON COLUMN public.billing_settings.paystack_subaccount_last_verified_at IS
  'When paystack_subaccount_verified_ok was last set (Online Payments open/save or nightly job).';
COMMENT ON COLUMN public.billing_settings.paystack_subaccount_last_verify_error IS
  'Last Paystack verification error message when verified_ok is false; null when ok.';
