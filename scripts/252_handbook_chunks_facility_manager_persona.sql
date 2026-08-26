-- 252: Allow facility_manager persona on handbook_chunks for FM portal RAG.
-- Apply to staging first.

ALTER TABLE public.handbook_chunks
  DROP CONSTRAINT IF EXISTS handbook_chunks_persona_check;

ALTER TABLE public.handbook_chunks
  ADD CONSTRAINT handbook_chunks_persona_check
  CHECK (persona IN ('staff', 'landlord', 'tenant', 'facility_manager'));

COMMENT ON COLUMN public.handbook_chunks.persona IS
  'Handbook audience: staff, landlord, tenant, or facility_manager.';
