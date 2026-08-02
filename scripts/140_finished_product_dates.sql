-- Script 140: Finished product manufacturing & expiration dates
--
-- Adds optional product-level date fields for Finished Products inventory.
-- Safe to re-run. Apply on staging first.
--
-- NOTE: These are master-data columns on finished_products (one value per
-- product). Production batches already have production_date; lot/batch-level
-- expiration is not modelled here.

BEGIN;

ALTER TABLE public.finished_products
  ADD COLUMN IF NOT EXISTS manufacturing_date date,
  ADD COLUMN IF NOT EXISTS expiration_date date;

COMMENT ON COLUMN public.finished_products.manufacturing_date IS
  'Optional product-level manufacturing date (not per production batch).';

COMMENT ON COLUMN public.finished_products.expiration_date IS
  'Optional product-level expiration date. NULL means no expiry badge in UI.';

COMMIT;
