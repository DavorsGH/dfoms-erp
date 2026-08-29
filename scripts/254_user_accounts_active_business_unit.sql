-- 254_user_accounts_active_business_unit.sql
-- Persist each staff user's active business-unit context (null = All Businesses).

BEGIN;

ALTER TABLE public.user_accounts
  ADD COLUMN IF NOT EXISTS active_business_unit_id uuid
  REFERENCES public.business_units (id)
  ON DELETE SET NULL;

COMMENT ON COLUMN public.user_accounts.active_business_unit_id IS
  'Staff active business-unit context for multi-business switching; null means All Businesses.';

CREATE INDEX IF NOT EXISTS user_accounts_active_business_unit_id_idx
  ON public.user_accounts (active_business_unit_id)
  WHERE active_business_unit_id IS NOT NULL;

COMMIT;
