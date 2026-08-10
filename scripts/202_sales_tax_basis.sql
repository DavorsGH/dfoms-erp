-- Script 202: Tenant-level VAT/WHT calculation basis for Client Invoices & Quotations.
-- Staging only — do NOT apply to production until explicitly approved.
--
-- sales_tax_basis controls whether VAT/NHIL/GETFund and WHT on new/edited client
-- invoices and quotations use Service cost only (default) or Total Cost
-- (Service + Material combined, net of line discounts).

BEGIN;

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS sales_tax_basis text NOT NULL DEFAULT 'service_only';

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_sales_tax_basis_check;

ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_sales_tax_basis_check
    CHECK (sales_tax_basis IN ('service_only', 'total_cost'));

COMMENT ON COLUMN public.tax_settings.sales_tax_basis IS
  'VAT/NHIL/GETFund and WHT base for Client Invoices and Client Quotations: '
  'service_only (labour/service column sum) or total_cost (subtotal). '
  'Applies when documents are created or saved; existing stored totals are unchanged.';

COMMIT;
