BEGIN;

ALTER TABLE public.business_units ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.business_units ADD COLUMN IF NOT EXISTS phone_alt text;
ALTER TABLE public.business_units ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.business_units ADD COLUMN IF NOT EXISTS business_registration_number text;

ALTER TABLE public.payment_accounts ADD COLUMN IF NOT EXISTS business_unit_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payment_accounts_business_unit_id_fkey'
  ) THEN
    ALTER TABLE public.payment_accounts
      ADD CONSTRAINT payment_accounts_business_unit_id_fkey
      FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS payment_accounts_tenant_id_business_unit_id_idx
  ON public.payment_accounts (tenant_id, business_unit_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
