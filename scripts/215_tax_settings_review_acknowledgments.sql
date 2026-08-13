-- Script 215: Tenant acknowledgment timestamps for default tax settings review.

BEGIN;

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS sales_tax_basis_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS product_sales_tax_rate_reviewed_at timestamptz;

COMMENT ON COLUMN public.tax_settings.sales_tax_basis_reviewed_at IS
  'Set when a tenant admin confirms the VAT/WHT calculation basis (sales_tax_basis).';

COMMENT ON COLUMN public.tax_settings.product_sales_tax_rate_reviewed_at IS
  'Set when a tenant admin confirms the product sales tax rate default.';

COMMIT;

NOTIFY pgrst, 'reload schema';
