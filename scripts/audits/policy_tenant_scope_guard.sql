-- Read-only: cross-tenant RLS leak pattern (Aug 2025 — is_super_admin without tenant scope).
-- Expected on production: zero rows.
-- CI / cron: utils/policy-tenant-scope-guard.ts (same logic).
-- Broader RBAC audit: npm run audit:tenant-rls

SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  p.qual AS using_expression,
  p.with_check AS with_check_expression
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    coalesce(p.qual, '') ~* 'is_super_admin\s*\('
    OR coalesce(p.with_check, '') ~* 'is_super_admin\s*\('
  )
  AND NOT (
    coalesce(p.qual, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
    OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
  )
ORDER BY p.tablename, p.policyname, p.cmd;
