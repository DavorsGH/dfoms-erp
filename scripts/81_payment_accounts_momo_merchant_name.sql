-- 81_payment_accounts_momo_merchant_name.sql
-- Adds momo_merchant_name to payment_accounts — the registered MoMo merchant/business
-- name (e.g. "Davors Enterprise"), distinct from momo_provider (the network: MTN/
-- Vodafone/AirtelTigo) and account_name (the entity shown on the invoice itself).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_accounts' AND column_name = 'momo_merchant_name'
  ) THEN
    RAISE EXCEPTION 'momo_merchant_name already exists on payment_accounts — aborting script 81';
  END IF;
END $$;

ALTER TABLE payment_accounts ADD COLUMN momo_merchant_name text;

COMMENT ON COLUMN payment_accounts.momo_merchant_name IS
  'Registered MoMo merchant/business name (e.g. "Davors Enterprise"), distinct from the network provider and the invoicing entity name.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_accounts' AND column_name = 'momo_merchant_name'
  ) THEN
    RAISE EXCEPTION 'momo_merchant_name column verification failed';
  END IF;
  RAISE NOTICE 'Script 81 complete: momo_merchant_name added to payment_accounts.';
END $$;

COMMIT;
