-- =============================================================================
-- 231_handbook_chunks.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Platform-wide handbook RAG chunks (not tenant-scoped).
-- Embeddings: Voyage AI voyage-3 (1024 dimensions).
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.handbook_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona text NOT NULL,
  section_title text NOT NULL,
  content text NOT NULL,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handbook_chunks_persona_check
    CHECK (persona IN ('staff', 'landlord', 'tenant'))
);

CREATE INDEX IF NOT EXISTS handbook_chunks_persona_idx
  ON public.handbook_chunks (persona);

-- HNSW suits this small, static reference dataset (no IVFFlat training step).
CREATE INDEX IF NOT EXISTS handbook_chunks_embedding_hnsw_idx
  ON public.handbook_chunks
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.handbook_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS handbook_chunks_select_authenticated ON public.handbook_chunks;
CREATE POLICY handbook_chunks_select_authenticated
  ON public.handbook_chunks
  FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.handbook_chunks TO authenticated;

COMMENT ON TABLE public.handbook_chunks IS
  'Davors platform handbook RAG chunks (not tenant-scoped). Ingested from content/handbook/*.md; embeddings via Voyage voyage-3 (1024 dims).';

COMMENT ON COLUMN public.handbook_chunks.persona IS
  'Handbook audience: staff, landlord, or tenant.';

COMMENT ON COLUMN public.handbook_chunks.section_title IS
  'Human-readable section heading used for chunk metadata and display.';

COMMENT ON COLUMN public.handbook_chunks.content IS
  'Markdown text chunk sent to the embedding model (includes section title for context).';

COMMIT;
