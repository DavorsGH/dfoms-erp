BEGIN;

ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS client_invoice_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'income_register_client_invoice_id_fkey'
  ) THEN
    ALTER TABLE public.income_register
      ADD CONSTRAINT income_register_client_invoice_id_fkey
      FOREIGN KEY (client_invoice_id)
      REFERENCES public.client_invoices (id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_income_register_client_invoice_id
  ON public.income_register (client_invoice_id)
  WHERE client_invoice_id IS NOT NULL;

UPDATE public.income_register ir
SET client_invoice_id = ci.id
FROM public.client_invoices ci
WHERE ir.client_invoice_id IS NULL
  AND ir.service_category = 'Client Invoice'
  AND ir.invoice_no IS NOT NULL
  AND trim(ir.invoice_no) <> ''
  AND ci.tenant_id = ir.tenant_id
  AND ci.invoice_number = ir.invoice_no;

COMMIT;

NOTIFY pgrst, 'reload schema';
