-- Read-only audit: policies that may leak cross-tenant data.
-- Run in Supabase SQL editor BEFORE and AFTER scripts/69_drop_legacy_cross_tenant_rls_policies.sql
--
-- A policy is flagged when its USING or WITH CHECK expression references role/access
-- helpers (is_super_admin, current_user_role, can_access_*, can_manage_*, can_write_*)
-- but does NOT reference tenant_matches(...) or current_user_tenant_id().

SELECT
  p.schemaname,
  p.tablename,
  p.policyname,
  p.cmd,
  p.permissive,
  p.roles,
  p.qual AS using_expression,
  p.with_check AS with_check_expression,
  EXISTS (
    SELECT 1
    FROM pg_policies p2
    WHERE p2.schemaname = p.schemaname
      AND p2.tablename = p.tablename
      AND p2.cmd = p.cmd
      AND p2.policyname <> p.policyname
      AND (
        coalesce(p2.qual, '') ILIKE '%tenant_matches(%'
        OR coalesce(p2.qual, '') ILIKE '%current_user_tenant_id()%'
        OR coalesce(p2.with_check, '') ILIKE '%tenant_matches(%'
        OR coalesce(p2.with_check, '') ILIKE '%current_user_tenant_id()%'
      )
  ) AS has_tenant_scoped_sibling_policy
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    coalesce(p.qual, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
    OR coalesce(p.with_check, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
  )
  AND NOT (
    coalesce(p.qual, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
    OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
  )
ORDER BY p.tablename, p.policyname, p.cmd;

-- Summary count by table
SELECT tablename, count(*) AS leaky_policy_count
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND (
    coalesce(p.qual, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
    OR coalesce(p.with_check, '') ~* '(is_super_admin\s*\(|current_user_role\s*\(|current_user_role\s*\(|can_access_[a-z_]+\s*\(|can_manage_[a-z_]+\s*\(|can_write_[a-z_]+\s*\()'
  )
  AND NOT (
    coalesce(p.qual, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
    OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
    OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
  )
GROUP BY tablename
ORDER BY leaky_policy_count DESC, tablename;
