-- Script 167: Track which hand-authored scripts/*.sql files were applied per environment.
-- This project does NOT use Supabase CLI migrations (no supabase/migrations/ folder);
-- numbered SQL lives in scripts/ and is applied manually or via apply-*-staging.ts runners.
--
-- Apply this script once per environment (staging first), then record each apply via:
--   npx tsx scripts/record-applied-sql-script.ts --env staging --script 69_drop_legacy_cross_tenant_rls_policies.sql
--
-- Query status:
--   npx tsx scripts/list-applied-sql-scripts.ts --env staging

BEGIN;

CREATE TABLE IF NOT EXISTS applied_sql_scripts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_name   TEXT NOT NULL,
  script_number INTEGER,
  environment   TEXT NOT NULL CHECK (environment IN ('local', 'staging', 'production')),
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by    TEXT,
  notes         TEXT,
  checksum      TEXT,
  CONSTRAINT applied_sql_scripts_name_env_key UNIQUE (script_name, environment)
);

CREATE INDEX IF NOT EXISTS applied_sql_scripts_env_applied_idx
  ON applied_sql_scripts (environment, applied_at DESC);

COMMENT ON TABLE applied_sql_scripts IS
  'Audit log of hand-applied scripts/*.sql files per environment. '
  'Complements (does not replace) Supabase CLI schema_migrations when CLI is adopted.';

COMMENT ON COLUMN applied_sql_scripts.script_number IS
  'Leading numeric prefix from filename when present (e.g. 69 from 69_drop_...sql).';

COMMENT ON COLUMN applied_sql_scripts.checksum IS
  'Optional SHA-256 hex of script file at apply time for drift detection.';

-- Read-only for authenticated (tenant admins should not mutate); writes via service_role / postgres.
ALTER TABLE applied_sql_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS applied_sql_scripts_service_role_all ON applied_sql_scripts;
CREATE POLICY applied_sql_scripts_service_role_all
  ON applied_sql_scripts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON applied_sql_scripts TO authenticated;
GRANT ALL ON applied_sql_scripts TO service_role;

CREATE OR REPLACE FUNCTION list_missing_sql_scripts(p_environment text)
RETURNS TABLE (
  script_name text,
  script_number integer,
  applied_at timestamptz,
  is_applied boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.script_name,
    a.script_number,
    a.applied_at,
    true AS is_applied
  FROM applied_sql_scripts a
  WHERE a.environment = p_environment
  ORDER BY a.script_number NULLS LAST, a.script_name;
$$;

COMMENT ON FUNCTION list_missing_sql_scripts IS
  'Lists recorded applies for an environment. Filename inventory comparison is done in scripts/list-applied-sql-scripts.ts.';

NOTIFY pgrst, 'reload schema';

COMMIT;
