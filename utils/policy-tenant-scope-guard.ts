import "server-only";

import pg from "pg";
import { resolveDatabaseUrl } from "@/utils/database-url";

export type CrossTenantPolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  using_expression: string | null;
  with_check_expression: string | null;
};

/** Same logic as scripts/audits/policy_tenant_scope_guard.sql */
export const POLICY_TENANT_SCOPE_GUARD_QUERY = `
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
      coalesce(p.qual, '') ~* 'is_super_admin\\s*\\('
      OR coalesce(p.with_check, '') ~* 'is_super_admin\\s*\\('
    )
    AND NOT (
      coalesce(p.qual, '') ILIKE '%tenant_matches(%'
      OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
      OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
      OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
    )
  ORDER BY p.tablename, p.policyname, p.cmd
`;

export async function auditCrossTenantSuperAdminPolicies(): Promise<{
  ok: boolean;
  rows: CrossTenantPolicyRow[];
  error: string | null;
}> {
  const connectionString = resolveDatabaseUrl();
  if (!connectionString) {
    return {
      ok: false,
      rows: [],
      error:
        "DATABASE_URL or SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL required for policy guard",
    };
  }

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const { rows } = (await client.query(
      POLICY_TENANT_SCOPE_GUARD_QUERY,
    )) as unknown as { rows: CrossTenantPolicyRow[] };
    return { ok: rows.length === 0, rows, error: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Policy tenant scope guard failed";
    return { ok: false, rows: [], error: message };
  } finally {
    await client.end().catch(() => undefined);
  }
}
