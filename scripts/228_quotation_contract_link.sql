-- =============================================================================
-- 228_quotation_contract_link.sql
-- Link accepted quotations to the service contract they raise.
-- Apply to staging first, verify with information_schema, then production.
-- Safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.service_contracts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS client_quotations_contract_id_idx
  ON public.client_quotations (contract_id)
  WHERE contract_id IS NOT NULL;

COMMENT ON COLUMN public.client_quotations.contract_id IS
  'Service contract raised from this quotation (Raise Contract action on accepted quotes).';

COMMIT;
