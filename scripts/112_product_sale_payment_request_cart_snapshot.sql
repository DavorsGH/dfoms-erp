-- Script 112: cart_snapshot for charge-first POS Mobile Money (Paystack Inline).
-- Staging first. Allows payment requests before income_register rows exist.

BEGIN;

ALTER TABLE public.product_sale_payment_requests
  ADD COLUMN IF NOT EXISTS cart_snapshot jsonb;

COMMENT ON COLUMN public.product_sale_payment_requests.cart_snapshot IS
  'POS cart payload for charge-first MoMo (create_product_sale runs after Paystack success).';

ALTER TABLE public.product_sale_payment_requests
  ALTER COLUMN income_ids SET DEFAULT '{}'::uuid[];

ALTER TABLE public.product_sale_payment_requests
  DROP CONSTRAINT IF EXISTS product_sale_payment_requests_income_ids_nonempty;

ALTER TABLE public.product_sale_payment_requests
  DROP CONSTRAINT IF EXISTS product_sale_payment_requests_channels_check;

ALTER TABLE public.product_sale_payment_requests
  DROP CONSTRAINT IF EXISTS product_sale_payment_requests_coverage_check;

ALTER TABLE public.product_sale_payment_requests
  ADD CONSTRAINT product_sale_payment_requests_coverage_check
  CHECK (
    cardinality(COALESCE(income_ids, '{}'::uuid[])) > 0
    OR cart_snapshot IS NOT NULL
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
