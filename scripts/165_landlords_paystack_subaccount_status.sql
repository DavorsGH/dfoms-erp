-- Script 165: Paystack rent settlement status for platform_only landlords.
-- Mirrors billing_settings.paystack_subaccount_status; reuses landlords.paystack_subaccount_code.
-- Apply on staging before production.

BEGIN;

ALTER TABLE public.landlords
  ADD COLUMN IF NOT EXISTS paystack_subaccount_status text;

-- Staff may have set paystack_subaccount_code before this column existed.
UPDATE public.landlords
SET paystack_subaccount_status = 'active'
WHERE paystack_subaccount_code IS NOT NULL
  AND btrim(paystack_subaccount_code) <> ''
  AND (
    paystack_subaccount_status IS NULL
    OR btrim(paystack_subaccount_status) = ''
  );

UPDATE public.landlords
SET paystack_subaccount_status = 'not_setup'
WHERE paystack_subaccount_status IS NULL
   OR btrim(paystack_subaccount_status) = '';

ALTER TABLE public.landlords
  ALTER COLUMN paystack_subaccount_status SET DEFAULT 'not_setup';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'landlords_paystack_subaccount_status_check'
  ) THEN
    ALTER TABLE public.landlords
      ADD CONSTRAINT landlords_paystack_subaccount_status_check
      CHECK (paystack_subaccount_status IN ('not_setup', 'pending', 'active'));
  END IF;
END $$;

ALTER TABLE public.landlords
  ALTER COLUMN paystack_subaccount_status SET NOT NULL;

COMMENT ON COLUMN public.landlords.paystack_subaccount_status IS
  'Paystack rent settlement account status for platform_only landlords '
  '(mirrors billing_settings.paystack_subaccount_status).';

COMMIT;
