/**
 * Apply scripts/266_admin_delete_payroll_history_for_employees.sql
 *
 * Usage:
 *   npx tsx scripts/apply-266-admin-delete-payroll-history-for-employees.ts --env staging --confirm-266
 *   npx tsx scripts/apply-266-admin-delete-payroll-history-for-employees.ts --env production --confirm-266 --confirm-266-staging-verified
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const FN = "admin_delete_payroll_history_for_employees";
const SQL_FILE = "scripts/266_admin_delete_payroll_history_for_employees.sql";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment: environment as "staging" | "production",
    confirm: argv.includes("--confirm-266"),
    confirmStagingVerified: argv.includes("--confirm-266-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

async function fetchFunctionDef(client: pg.Client): Promise<string | null> {
  const { rows } = await client.query<{ src: string | null }>(
    `
    SELECT pg_get_functiondef(p.oid) AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = $1
      AND pg_get_function_identity_arguments(p.oid) = 'p_month date, p_tenant_id uuid, p_employee_ids text[]'
    `,
    [FN],
  );
  return rows[0]?.src ?? null;
}

async function assertFunctionOk(client: pg.Client, label: string) {
  const src = await fetchFunctionDef(client);
  if (!src) {
    throw new Error(`${label}: function ${FN}(date, uuid, text[]) not found`);
  }
  const checks: Array<[string, boolean]> = [
    ["SECURITY DEFINER", /SECURITY DEFINER/i.test(src)],
    ["DISABLE TRIGGER trg_protect_locked_payroll", /DISABLE TRIGGER trg_protect_locked_payroll/i.test(src)],
    ["ENABLE TRIGGER trg_protect_locked_payroll", /ENABLE TRIGGER trg_protect_locked_payroll/i.test(src)],
    ["DELETE FROM payroll_history", /DELETE FROM payroll_history/i.test(src)],
    ["employee_id = ANY", /employee_id\s*=\s*ANY/i.test(src)],
    ["tenant_id = p_tenant_id", /tenant_id\s*=\s*p_tenant_id/i.test(src)],
  ];
  for (const [name, ok] of checks) {
    if (!ok) throw new Error(`${label}: missing expected body piece: ${name}`);
  }

  const { rows: grants } = await client.query<{ grantee: string; privilege_type: string }>(
    `
    SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name = $1
    `,
    [FN],
  );
  const serviceRoleExec = grants.some(
    (g) =>
      g.grantee === "service_role" &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (!serviceRoleExec) {
    throw new Error(`${label}: service_role missing EXECUTE on ${FN}`);
  }
  const publicExec = grants.some(
    (g) =>
      (g.grantee === "PUBLIC" || g.grantee === "public") &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (publicExec) {
    throw new Error(`${label}: PUBLIC still has EXECUTE on ${FN} (should be revoked)`);
  }

  console.log(`${label}: OK ${FN} present with expected body + grants`);
  return src;
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-266 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-266-staging-verified",
    );
  }

  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef =
    environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!supabaseUrl.includes(expectedRef)) {
    throw new Error(
      `Refusing: NEXT_PUBLIC_SUPABASE_URL does not look like ${environment} (${expectedRef})`,
    );
  }
  if (!dbUrl.includes(expectedRef)) {
    throw new Error(
      `Refusing: DATABASE_URL does not look like ${environment} (${expectedRef})`,
    );
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log(`=== ${environment} ${verifyOnly ? "VERIFY" : "APPLY"} ${FN} ===`);
    console.log(`ref=${expectedRef}`);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (!sql.includes(FN)) {
        throw new Error(`SQL file missing function name ${FN}`);
      }
      console.log(`Applying ${SQL_FILE}...`);
      await client.query(sql);
      console.log("SQL applied");
    }

    await assertFunctionOk(client, environment.toUpperCase());
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
