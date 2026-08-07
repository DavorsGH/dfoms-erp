/**
 * CI / pre-deploy gate: fail when RLS policies grant privileged-role access
 * without tenant_matches(tenant_id) or current_user_tenant_id() on tenant-scoped tables.
 *
 * Usage:
 *   npm run audit:tenant-rls
 *   npx tsx scripts/audit-tenant-rls.ts --env-file .env.staging.local
 *
 * Exit 0 = pass. Exit 1 = leaky policies found or DB unreachable.
 *
 * SQL reference: scripts/audit-cross-tenant-rls-policies.sql
 */
import { connectPg } from "./lib/pg-connect";

/** Policies that are user-self only, not tenant RBAC. */
const ALWAYS_IGNORE = new Set(["user_can_read_own_account"]);

export type LeakyPolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  using_expression: string | null;
  with_check_expression: string | null;
  has_tenant_scoped_sibling_policy: boolean;
};

const LEAKY_POLICY_QUERY = `
  SELECT
    p.tablename,
    p.policyname,
    p.cmd,
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
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = p.tablename
        AND c.column_name = 'tenant_id'
    )
    AND (
      coalesce(p.qual, '') ~* '(is_super_admin\\s*\\(|current_user_role\\s*\\(|can_access_[a-z_]+\\s*\\(|can_manage_[a-z_]+\\s*\\(|can_write_[a-z_]+\\s*\\()'
      OR coalesce(p.with_check, '') ~* '(is_super_admin\\s*\\(|current_user_role\\s*\\(|can_access_[a-z_]+\\s*\\(|can_manage_[a-z_]+\\s*\\(|can_write_[a-z_]+\\s*\\()'
    )
    AND NOT (
      coalesce(p.qual, '') ILIKE '%tenant_matches(%'
      OR coalesce(p.qual, '') ILIKE '%current_user_tenant_id()%'
      OR coalesce(p.with_check, '') ILIKE '%tenant_matches(%'
      OR coalesce(p.with_check, '') ILIKE '%current_user_tenant_id()%'
    )
  ORDER BY p.tablename, p.policyname, p.cmd
`;

function parseArgs(argv: string[]) {
  return {
    stagingOnly: !argv.includes("--any-project"),
    envFile: argv.includes("--env-file")
      ? argv[argv.indexOf("--env-file") + 1]
      : undefined,
  };
}

function formatPolicy(row: LeakyPolicyRow): string {
  const sibling = row.has_tenant_scoped_sibling_policy
    ? "has tenant-scoped sibling (OR still leaks!)"
    : "no tenant-scoped sibling";
  return `  ${row.tablename}.${row.policyname} [${row.cmd}] — ${sibling}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const requiredRef = args.stagingOnly ? "wieflwbfdmjtsdnwbfii" : undefined;

  let client;
  try {
    const connected = await connectPg({
      requiredProjectRef: requiredRef,
      envFiles: args.envFile ? [args.envFile] : undefined,
    });
    client = connected.client;
    console.log(
      `Connected (${connected.envFile}, candidate ${connected.candidateIndex})`,
    );
  } catch (error) {
    console.error("TENANT RLS AUDIT: FAILED — cannot connect to database.");
    console.error(error instanceof Error ? error.message : error);
    console.error(
      "\nSet DATABASE_URL (or SUPABASE_DB_PASSWORD) in .env.staging.local, or run in CI with secrets.",
    );
    process.exit(1);
  }

  try {
    const { rows } = (await client.query(LEAKY_POLICY_QUERY)) as unknown as {
      rows: LeakyPolicyRow[];
    };
    const superAdminFull = (await client.query(`
      SELECT count(*)::int AS n FROM pg_policies
      WHERE schemaname = 'public' AND policyname = 'super_admin_full_access'
    `)) as unknown as { rows: { n: number }[] };

    const filtered = rows.filter(
      (row) => !ALWAYS_IGNORE.has(row.policyname),
    );

    console.log("\n=== Tenant RLS audit ===");
    console.log(
      `super_admin_full_access policies (any table): ${superAdminFull.rows[0]?.n ?? 0}`,
    );
    console.log(
      `Leaky privileged policies on tenant-scoped tables: ${filtered.length}`,
    );

    if (filtered.length > 0) {
      console.error("\nFAIL — offending policies:");
      let currentTable = "";
      for (const row of filtered) {
        if (row.tablename !== currentTable) {
          currentTable = row.tablename;
          console.error(`\n[${row.tablename}]`);
        }
        console.error(formatPolicy(row));
        const usingExpr = (row.using_expression ?? "").slice(0, 120);
        if (usingExpr) {
          console.error(`    USING: ${usingExpr}${usingExpr.length >= 120 ? "…" : ""}`);
        }
      }
      console.error(
        `\n${filtered.length} policy/policies must include tenant_matches(tenant_id) (or current_user_tenant_id()) alongside privileged-role checks.`,
      );
      console.error("Fix pattern: scripts/128_tax_ledger_super_admin_tenant_scope_rls.sql");
      process.exit(1);
    }

    console.log("\nPASS — no leaky privileged-role policies on tenant-scoped tables.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
