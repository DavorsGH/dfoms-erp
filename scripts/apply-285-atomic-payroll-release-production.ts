/**
 * Apply scripts/285_atomic_payroll_release.sql
 *
 * Requires script 279 (_delete_payroll_lock_finance, admin_delete_payroll_history_for_employees).
 *
 * Usage:
 *   npx tsx scripts/apply-285-atomic-payroll-release-production.ts --env staging --confirm-285
 *   npx tsx scripts/apply-285-atomic-payroll-release-production.ts --env production --confirm-285 --confirm-285-staging-verified
 *   npx tsx scripts/apply-285-atomic-payroll-release-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/285_atomic_payroll_release.sql";

const PUBLIC_RPCS = ["release_payroll_period", "reopen_payroll_period"] as const;

const PRIVATE_HELPERS = [
  "_payroll_restore_processing_from_history",
  "_payroll_open_period_core",
] as const;

const SCRIPT_279_DEPENDENCIES = [
  "_delete_payroll_lock_finance",
  "_payroll_history_rows_to_jsonb",
  "admin_delete_payroll_history_for_employees",
] as const;

type DataSnapshot = {
  month_end_close_count: number;
  payroll_history_count: number;
  payroll_processing_count: number;
};

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
    confirm: argv.includes("--confirm-285"),
    confirmStagingVerified: argv.includes("--confirm-285-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM month_end_close) AS month_end_close_count,
      (SELECT count(*)::int FROM payroll_history) AS payroll_history_count,
      (SELECT count(*)::int FROM payroll_processing) AS payroll_processing_count
  `);
  return rows[0];
}

async function assertFunctionExists(client: pg.Client, fn: string, label: string) {
  const { rows } = await client.query<{ cnt: string }>(
    `
    SELECT count(*)::text AS cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1
    `,
    [fn],
  );
  if (Number(rows[0]?.cnt ?? 0) < 1) {
    throw new Error(`${label}: missing function ${fn}`);
  }
}

async function assertScript279Dependency(client: pg.Client, label: string) {
  console.log(`\n=== ${label} script 279 dependency check ===`);
  for (const fn of SCRIPT_279_DEPENDENCIES) {
    await assertFunctionExists(client, fn, label);
    console.log(`${label}: OK dependency ${fn}`);
  }
}

async function assertRpcGrants(client: pg.Client, fn: string) {
  const { rows: grants } = await client.query<{
    grantee: string;
    privilege_type: string;
  }>(
    `
    SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name = $1
    `,
    [fn],
  );

  const serviceRoleExec = grants.some(
    (g) =>
      g.grantee === "service_role" &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (!serviceRoleExec) {
    throw new Error(`${fn}: service_role missing EXECUTE`);
  }

  const publicExec = grants.some(
    (g) =>
      (g.grantee === "PUBLIC" || g.grantee === "public") &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (publicExec) {
    throw new Error(`${fn}: PUBLIC still has EXECUTE (should be revoked)`);
  }
}

async function assertHelperGrants(client: pg.Client, fn: string, label: string) {
  const { rows: grants } = await client.query<{
    grantee: string;
    privilege_type: string;
  }>(
    `
    SELECT grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name = $1
    `,
    [fn],
  );

  const publicExec = grants.some(
    (g) =>
      (g.grantee === "PUBLIC" || g.grantee === "public") &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (publicExec) {
    throw new Error(`${label}: ${fn} still granted to PUBLIC (internal helper)`);
  }

  console.log(
    `${label}: OK helper ${fn} (exists, not granted to PUBLIC)`,
  );
}

async function assertFunctions(client: pg.Client, label: string) {
  const { rows: restoreSrcRows } = await client.query<{ src: string | null }>(
    `
    SELECT pg_get_functiondef(p.oid) AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_payroll_restore_processing_from_history'
    LIMIT 1
    `,
  );
  const restoreSrc = restoreSrcRows[0]?.src ?? "";
  if (!restoreSrc) {
    throw new Error(`${label}: missing _payroll_restore_processing_from_history`);
  }
  if (!/daily_rate,\s*\n\s*days_to_pay,/s.test(restoreSrc)) {
    throw new Error(
      `${label}: _payroll_restore_processing_from_history missing daily_rate/days_to_pay columns`,
    );
  }
  await assertHelperGrants(
    client,
    "_payroll_restore_processing_from_history",
    label,
  );

  const { rows: coreSrcRows } = await client.query<{ src: string | null }>(
    `
    SELECT pg_get_functiondef(p.oid) AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_payroll_open_period_core'
    LIMIT 1
    `,
  );
  const coreSrc = coreSrcRows[0]?.src ?? "";
  if (!coreSrc) {
    throw new Error(`${label}: missing _payroll_open_period_core`);
  }
  if (!/_delete_payroll_lock_finance/i.test(coreSrc)) {
    throw new Error(`${label}: _payroll_open_period_core missing finance delete call`);
  }
  if (!/_payroll_restore_processing_from_history/i.test(coreSrc)) {
    throw new Error(`${label}: _payroll_open_period_core missing processing restore call`);
  }
  await assertHelperGrants(client, "_payroll_open_period_core", label);

  for (const fn of PUBLIC_RPCS) {
    const { rows } = await client.query<{ src: string | null }>(
      `
      SELECT pg_get_functiondef(p.oid) AS src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1
      LIMIT 1
      `,
      [fn],
    );
    const src = rows[0]?.src;
    if (!src) {
      throw new Error(`${label}: missing public RPC ${fn}`);
    }
    if (!/SECURITY DEFINER/i.test(src)) {
      throw new Error(`${label}: ${fn} is not SECURITY DEFINER`);
    }
    if (!/_payroll_open_period_core/i.test(src)) {
      throw new Error(`${label}: ${fn} does not delegate to _payroll_open_period_core`);
    }
    if (
      fn === "reopen_payroll_period" &&
      !/Only partially locked periods can be reopened/i.test(src)
    ) {
      throw new Error(`${label}: reopen_payroll_period missing Partial gate`);
    }
    if (
      fn === "release_payroll_period" &&
      !/Only permanently locked periods can be released/i.test(src)
    ) {
      throw new Error(`${label}: release_payroll_period missing Locked gate`);
    }
    await assertRpcGrants(client, fn);
    console.log(
      `${label}: OK ${fn} (SECURITY DEFINER, service_role EXECUTE, PUBLIC revoked, uses shared core)`,
    );
  }
}

async function assertHistoryColumns(client: pg.Client, label: string) {
  const { rows } = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payroll_history'
      AND column_name IN ('daily_rate', 'days_to_pay')
    ORDER BY column_name
    `,
  );
  const cols = rows.map((r) => r.column_name);
  if (!cols.includes("daily_rate") || !cols.includes("days_to_pay")) {
    throw new Error(
      `${label}: payroll_history missing daily_rate/days_to_pay columns (${cols.join(", ")})`,
    );
  }
  console.log(`${label}: OK payroll_history has daily_rate + days_to_pay columns`);
}

async function assertCallableWithoutMutation(client: pg.Client, label: string) {
  const reopenFail = await client
    .query(
      `
    SELECT public.reopen_payroll_period(
      NULL::uuid,
      NULL::uuid,
      ARRAY[]::text[],
      '2099-01-01'::date,
      2099,
      1
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!reopenFail.ok || !/tenant_id is required/i.test(reopenFail.message)) {
    throw new Error(
      `${label}: reopen_payroll_period callable check failed: ${reopenFail.message}`,
    );
  }
  console.log(`${label}: OK reopen_payroll_period callable (validation guard)`);

  const releaseFail = await client
    .query(
      `
    SELECT public.release_payroll_period(
      NULL::uuid,
      NULL::uuid,
      ARRAY[]::text[],
      '2099-01-01'::date,
      2099,
      1
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!releaseFail.ok || !/tenant_id is required/i.test(releaseFail.message)) {
    throw new Error(
      `${label}: release_payroll_period callable check failed: ${releaseFail.message}`,
    );
  }
  console.log(`${label}: OK release_payroll_period callable (validation guard)`);
}

async function assertRouteReferences() {
  const releaseRoute = readFileSync(
    resolve("app/api/hr-payroll/release-period/route.ts"),
    "utf8",
  );
  const reopenRoute = readFileSync(
    resolve("app/api/hr-payroll/reopen-period/route.ts"),
    "utf8",
  );

  if (!releaseRoute.includes('admin.rpc("release_payroll_period"')) {
    throw new Error("release-period route does not call release_payroll_period RPC");
  }
  if (releaseRoute.includes("deletePayrollLockFinanceEntries")) {
    throw new Error("release-period route still references legacy sequential finance utils");
  }
  if (!reopenRoute.includes('admin.rpc("reopen_payroll_period"')) {
    throw new Error("reopen-period route does not call reopen_payroll_period RPC");
  }
  console.log("OK: route files reference atomic RPCs only");
}

async function assertSupabaseRpcSurface(
  url: string,
  serviceKey: string,
  label: string,
) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error: reopenError } = await admin.rpc("reopen_payroll_period", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_employee_ids: [],
    p_payroll_month: "2099-01-01",
    p_period_year: 2099,
    p_period_month: 1,
  });
  if (!reopenError || !/tenant_id is required/i.test(reopenError.message)) {
    throw new Error(
      `${label}: Supabase reopen_payroll_period surface failed: ${reopenError?.message ?? "no error"}`,
    );
  }

  const { error: releaseError } = await admin.rpc("release_payroll_period", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_employee_ids: [],
    p_payroll_month: "2099-01-01",
    p_period_year: 2099,
    p_period_month: 1,
  });
  if (!releaseError || !/tenant_id is required/i.test(releaseError.message)) {
    throw new Error(
      `${label}: Supabase release_payroll_period surface failed: ${releaseError?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-285 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-285-staging-verified",
    );
  }

  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef =
    environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

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
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required");
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const label = environment.toUpperCase();

  try {
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 285 atomic payroll release ===`);
    console.log(`ref=${expectedRef}`);

    await assertScript279Dependency(client, label);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (
        !sql.includes("release_payroll_period") ||
        !sql.includes("_payroll_restore_processing_from_history")
      ) {
        throw new Error("SQL file missing expected function names");
      }
      console.log(`\nApplying ${SQL_FILE}...`);
      await client.query(sql);
      console.log("SQL applied");
    }

    const after = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (after) ===");
    console.log(after);

    for (const key of Object.keys(before) as (keyof DataSnapshot)[]) {
      if (before[key] !== after[key]) {
        throw new Error(
          `Data mutation detected on ${key}: before=${before[key]} after=${after[key]}`,
        );
      }
    }
    console.log("\nOK: payroll table row counts unchanged (function-only migration)");

    await assertHistoryColumns(client, label);
    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertRouteReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 285 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
