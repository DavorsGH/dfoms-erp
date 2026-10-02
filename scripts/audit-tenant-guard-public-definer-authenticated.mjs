import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

const AUDIT_SQL = `
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS returns,
  (p.prosrc ILIKE '%assert_caller_can_act_for_tenant%') AS has_guard,
  (p.prosrc ~* 'current_user_tenant_id|tenant_matches') AS uses_session_tenant,
  (pg_get_function_identity_arguments(p.oid) ILIKE '%tenant_id%') AS takes_tenant_param
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.prokind = 'f'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT (p.proname ~ '__impl$')
ORDER BY takes_tenant_param DESC, has_guard, p.proname;
`;

async function main() {
  const staging = resolve(process.cwd(), ".env.staging.local");
  try {
    loadEnvFile(staging);
  } catch {
    /* optional */
  }
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL missing");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const res = await client.query(AUDIT_SQL);
    const outPath = resolve(
      process.cwd(),
      "scripts/audit-tenant-guard-public-definer-authenticated.json",
    );
    writeFileSync(
      outPath,
      JSON.stringify({ rowCount: res.rowCount, rows: res.rows }, null, 2),
    );

    const unguarded = res.rows.filter((r) => !r.has_guard);
    console.log("rows:", res.rowCount);
    console.log(
      "without assert_caller_can_act_for_tenant:",
      unguarded.length,
    );
    console.log(
      "takes_tenant_param=true without guard:",
      unguarded.filter((r) => r.takes_tenant_param).length,
    );
    console.log("sample unguarded (first 30):");
    for (const r of unguarded.slice(0, 30)) {
      console.log(
        ` - ${r.proname} | tenant_param: ${r.takes_tenant_param} | session_tenant: ${r.uses_session_tenant}`,
      );
    }
    console.log("full output:", outPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
