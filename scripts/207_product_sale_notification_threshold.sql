-- Script 207: product_sale_notification_threshold on tax_settings
--
-- Tenant-adjustable minimum product sale amount (GHS) before Admin/Director
-- in-app alerts fire. Default 2000.
--
-- Safe to re-run. Apply on staging first.

BEGIN;

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS product_sale_notification_threshold numeric(14, 2)
    NOT NULL DEFAULT 2000;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_product_sale_notification_threshold_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_product_sale_notification_threshold_check
  CHECK (product_sale_notification_threshold >= 0);

COMMENT ON COLUMN public.tax_settings.product_sale_notification_threshold IS
  'Minimum product sale amount (GHS) that triggers Admin/Director in-app '
  'notifications. Stored per tenant alongside other statutory ledger settings.';

COMMIT;
