-- 216_client_quotations_discount_and_commercial_terms.sql
-- Percentage header discount + optional commercial terms footnote on quotations.

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS discount_type text NOT NULL DEFAULT 'flat'
    CHECK (discount_type IN ('flat', 'percentage'));

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS discount_percentage numeric(8, 4);

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS commercial_terms text;

COMMIT;
