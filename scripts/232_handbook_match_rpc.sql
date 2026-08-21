-- =============================================================================
-- 232_handbook_match_rpc.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Cosine similarity search over handbook_chunks for RAG retrieval.
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.match_handbook_chunks(
  query_embedding vector(1024),
  match_persona text,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  section_title text,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    hc.id,
    hc.section_title,
    hc.content,
    1 - (hc.embedding <=> query_embedding) AS similarity
  FROM public.handbook_chunks hc
  WHERE hc.persona = match_persona
  ORDER BY hc.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(match_count, 1), 10);
$$;

REVOKE ALL ON FUNCTION public.match_handbook_chunks(vector(1024), text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_handbook_chunks(vector(1024), text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_handbook_chunks(vector(1024), text, integer) TO service_role;

COMMENT ON FUNCTION public.match_handbook_chunks(vector(1024), text, integer) IS
  'Returns top handbook_chunks by cosine similarity for DAVORS-ERP assistant RAG.';

COMMIT;
