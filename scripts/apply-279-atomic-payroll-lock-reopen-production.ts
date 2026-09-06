/**
 * Apply scripts/279_atomic_payroll_lock_reopen.sql
 *
 * Usage:
 *   npx tsx scripts/apply-279-atomic-payroll-lock-reopen-production.ts --env staging --confirm-279
 *   npx tsx scripts/apply-279-atomic-payroll-lock-reopen-production.ts --env production --confirm-279 --confirm-279-staging-verified
 *   npx tsx scripts/apply-279-atomic-payroll-lock-reopen-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/279_atomic_payroll_lock_reopen.sql";

const PUBLIC_RPCS = ["lock_payroll_period", "reopen_payroll_period"] as const;

const PRIVATE_HELPERS = [
  "_post_payroll_lock_finance",
  "_delete_payroll_lock_finance",
  "_payroll_apply_loan_repayments",
  "_payroll_reverse_loan_repayments",
  "_payroll_sync_statutory_tax_ledger",
  "_payroll_delete_open_statutory_tax_ledger",
  "_promote_payroll_allowance_lines_to_history",
  "_payroll_upsert_lock_expense",
  "_payroll_upsert_deduction_savings_income",
  "_payroll_tax_ledger_source_id",
  "_payroll_is_month_ended",
] as const;

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
    confirm: argv.includes("--confirm-279"),
    confirmStagingVerified: argv.includes("--confirm-279-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

type DataSnapshot = {
  month_end_close: number;
  payroll_history: number;
  payroll_processing: number;
  payroll_lock_expenses: number;
  payroll_dedsav_income: number;
  payroll_period_tax_legs: number;
  loan_register: number;
};

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM month_end_close) AS month_end_close,
      (SELECT count(*)::int FROM payroll_history) AS payroll_history,
      (SELECT count(*)::int FROM payroll_processing) AS payroll_processing,
      (
        SELECT count(*)::int FROM expense_register
        WHERE receipt_no LIKE 'PAYROLL-%'
      ) AS payroll_lock_expenses,
      (
        SELECT count(*)::int FROM income_register
        WHERE invoice_no LIKE 'PAYROLL-DEDSAV-%'
      ) AS payroll_dedsav_income,
      (
        SELECT count(*)::int FROM tax_ledger_entries
        WHERE source_type = 'payroll_period'
      ) AS payroll_period_tax_legs,
      (SELECT count(*)::int FROM loan_register) AS loan_register
  `);
  return rows[0];
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

async function assertFunctions(client: pg.Client, label: string) {
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
    if (fn === "lock_payroll_period" && !/_post_payroll_lock_finance/i.test(src)) {
      throw new Error(`${label}: lock_payroll_period missing finance post call`);
    }
    if (fn === "reopen_payroll_period" && !/_delete_payroll_lock_finance/i.test(src)) {
      throw new Error(`${label}: reopen_payroll_period missing finance delete call`);
    }
    await assertRpcGrants(client, fn);
    console.log(`${label}: OK ${fn} (SECURITY DEFINER, service_role EXECUTE, PUBLIC revoked)`);
  }

  for (const fn of PRIVATE_HELPERS) {
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
      throw new Error(`${label}: missing helper ${fn}`);
    }
    console.log(`${label}: OK helper ${fn}`);
  }
}

async function assertCallableWithoutMutation(client: pg.Client, label: string) {
  const lockFail = await client.query(
    `
    SELECT public.lock_payroll_period(
      NULL::uuid,
      NULL::uuid,
      ARRAY[]::text[],
      '2099-01-01'::date,
      2099,
      1,
      'Locked',
      NULL,
      '[]'::jsonb
    )
    `,
  ).then(
    () => ({ ok: false, message: "expected validation failure" }),
    (err: Error) => ({ ok: true, message: err.message }),
  );
  if (!lockFail.ok || !/tenant_id is required/i.test(lockFail.message)) {
    throw new Error(
      `${label}: lock_payroll_period callable check failed: ${lockFail.message}`,
    );
  }
  console.log(`${label}: OK lock_payroll_period callable (validation guard)`);

  const reopenFail = await client.query(
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
  ).then(
    () => ({ ok: false, message: "expected validation failure" }),
    (err: Error) => ({ ok: true, message: err.message }),
  );
  if (!reopenFail.ok || !/tenant_id is required/i.test(reopenFail.message)) {
    throw new Error(
      `${label}: reopen_payroll_period callable check failed: ${reopenFail.message}`,
    );
  }
  console.log(`${label}: OK reopen_payroll_period callable (validation guard)`);
}

async function assertRouteReferences() {
  const lockRoute = readFileSync(
    resolve("app/api/hr-payroll/lock-period/route.ts"),
    "utf8",
  );
  const reopenRoute = readFileSync(
    resolve("app/api/hr-payroll/reopen-period/route.ts"),
    "utf8",
  );
  if (!lockRoute.includes('admin.rpc("lock_payroll_period"')) {
    throw new Error("lock-period route does not call lock_payroll_period RPC");
  }
  if (!reopenRoute.includes('admin.rpc("reopen_payroll_period"')) {
    throw new Error("reopen-period route does not call reopen_payroll_period RPC");
  }
  if (lockRoute.includes("postPayrollLockFinanceEntries")) {
    throw new Error("lock-period route still references legacy sequential finance utils");
  }
  if (reopenRoute.includes("deletePayrollLockFinanceEntries")) {
    throw new Error("reopen-period route still references legacy sequential finance utils");
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

  const { error: lockError } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_employee_ids: [],
    p_payroll_month: "2099-01-01",
    p_period_year: 2099,
    p_period_month: 1,
    p_lock_status: "Locked",
    p_notes: null,
    p_rows: [],
  });
  if (!lockError || !/tenant_id is required/i.test(lockError.message)) {
    throw new Error(
      `${label}: Supabase lock_payroll_period surface failed: ${lockError?.message ?? "no error"}`,
    );
  }

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

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-279 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-279-staging-verified",
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
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 279 atomic payroll lock/reopen ===`);
    console.log(`ref=${expectedRef}`);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (!sql.includes("lock_payroll_period") || !sql.includes("reopen_payroll_period")) {
        throw new Error("SQL file missing expected RPC names");
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
    console.log("\nOK: payroll-related table row counts unchanged (function-only migration)");

    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertRouteReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 279 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
