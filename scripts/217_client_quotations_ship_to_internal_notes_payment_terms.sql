-- 217: Ship-to address, internal notes, and payment terms on client quotations.

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS ship_to_name text;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS ship_to_address text;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS ship_to_phone text;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS internal_notes text;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS payment_terms text DEFAULT 'Net 30';

UPDATE public.client_quotations
SET payment_terms = 'Net 30'
WHERE payment_terms IS NULL;

COMMENT ON COLUMN public.client_quotations.ship_to_name IS
  'Optional ship-to name when different from bill-to. NULL when same as billing.';
COMMENT ON COLUMN public.client_quotations.ship_to_address IS
  'Optional ship-to address when different from bill-to. NULL when same as billing.';
COMMENT ON COLUMN public.client_quotations.ship_to_phone IS
  'Optional ship-to phone when different from bill-to. NULL when same as billing.';
COMMENT ON COLUMN public.client_quotations.internal_notes IS
  'Staff-only internal notes. Never shown on PDF or client portal.';
COMMENT ON COLUMN public.client_quotations.payment_terms IS
  'Customer-facing payment terms label (e.g. Net 30). Shown on printed quotation.';

COMMIT;

NOTIFY pgrst, 'reload schema';
