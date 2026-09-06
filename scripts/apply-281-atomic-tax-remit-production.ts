/**
 * Apply scripts/281_atomic_tax_remit.sql
 *
 * Usage:
 *   npx tsx scripts/apply-281-atomic-tax-remit-production.ts --env staging --confirm-281
 *   npx tsx scripts/apply-281-atomic-tax-remit-production.ts --env production --confirm-281 --confirm-281-staging-verified
 *   npx tsx scripts/apply-281-atomic-tax-remit-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/281_atomic_tax_remit.sql";

const PUBLIC_RPCS = [
  "remit_tax_for_period",
  "undo_remit_tax_for_period",
] as const;

const PRIVATE_HELPERS = [
  "_tr_round_currency",
  "_tr_normalize_payment_status",
  "_tr_is_paid_status",
  "_tr_is_settled_no_cash_status",
  "_tr_is_accrued_status",
  "_tr_period_key",
  "_tr_period_end_date",
  "_tr_period_label",
  "_tr_remit_kind_label",
  "_tr_remit_receipt_prefix",
  "_tr_build_remit_receipt_no",
  "_tr_build_payroll_essnit_receipt_no",
  "_tr_components_for_remit_kind",
  "_tr_is_employer_ssnit_component",
  "_tr_append_remitted_note",
  "_tr_strip_remitted_note",
  "_tr_bu_scope_matches",
  "_tr_days_in_month",
  "_tr_build_return_due_date",
  "_tr_add_calendar_months",
  "_tr_advance_due_date_after_remittance",
  "_tr_statutory_kind_for_component",
  "_tr_has_open_entries_for_statutory_kind",
  "_tr_compute_remit_cash_amount",
  "_tr_align_essnit_for_ssnit_remit",
  "_tr_restore_essnit_after_ssnit_undo",
  "_tr_apply_remittance_due_date_patch",
  "_tr_remit_result",
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
    confirm: argv.includes("--confirm-281"),
    confirmStagingVerified: argv.includes("--confirm-281-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

type DataSnapshot = {
  expense_register_count: number;
  expense_register_amount_sum: string;
  tax_ledger_entries_count: number;
  tax_ledger_entries_tax_sum: string;
  tax_settings_count: number;
};

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM expense_register) AS expense_register_count,
      (SELECT coalesce(sum(amount), 0)::text FROM expense_register) AS expense_register_amount_sum,
      (SELECT count(*)::int FROM tax_ledger_entries) AS tax_ledger_entries_count,
      (SELECT coalesce(sum(tax_amount), 0)::text FROM tax_ledger_entries) AS tax_ledger_entries_tax_sum,
      (SELECT count(*)::int FROM tax_settings) AS tax_settings_count
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
    if (
      fn === "remit_tax_for_period" &&
      !/_tr_apply_remittance_due_date_patch/i.test(src)
    ) {
      throw new Error(`${label}: remit_tax_for_period missing due-date patch call`);
    }
    if (
      fn === "undo_remit_tax_for_period" &&
      !/_tr_restore_essnit_after_ssnit_undo/i.test(src)
    ) {
      throw new Error(`${label}: undo_remit_tax_for_period missing ESSNIT restore call`);
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
  const remitFail = await client
    .query(
      `
    SELECT public.remit_tax_for_period(
      NULL::uuid,
      NULL::uuid,
      NULL::date,
      NULL::text,
      false
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!remitFail.ok || !/tenant is required/i.test(remitFail.message)) {
    throw new Error(
      `${label}: remit_tax_for_period callable check failed: ${remitFail.message}`,
    );
  }
  console.log(`${label}: OK remit_tax_for_period callable (validation guard)`);

  const undoFail = await client
    .query(
      `
    SELECT public.undo_remit_tax_for_period(
      NULL::uuid,
      NULL::uuid,
      NULL::date,
      NULL::text
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!undoFail.ok || !/tenant is required/i.test(undoFail.message)) {
    throw new Error(
      `${label}: undo_remit_tax_for_period callable check failed: ${undoFail.message}`,
    );
  }
  console.log(`${label}: OK undo_remit_tax_for_period callable (validation guard)`);
}

async function assertRouteReferences() {
  const remitRoute = readFileSync(
    resolve("app/api/finance/tax-ledger/remit/route.ts"),
    "utf8",
  );
  const undoRoute = readFileSync(
    resolve("app/api/finance/tax-ledger/undo-remit/route.ts"),
    "utf8",
  );

  if (!remitRoute.includes('admin.rpc("remit_tax_for_period"')) {
    throw new Error("remit route does not call remit_tax_for_period RPC");
  }
  if (remitRoute.includes("remitTaxForPeriod(")) {
    throw new Error("remit route still calls legacy remitTaxForPeriod util");
  }
  if (!undoRoute.includes('admin.rpc("undo_remit_tax_for_period"')) {
    throw new Error("undo-remit route does not call undo_remit_tax_for_period RPC");
  }
  if (undoRoute.includes("undoRemitTaxForPeriod(")) {
    throw new Error("undo-remit route still calls legacy undoRemitTaxForPeriod util");
  }
  if (!remitRoute.includes("requireTenantRoleIn(FINANCE_SECTION_ROLES)")) {
    throw new Error("remit route missing FINANCE_SECTION_ROLES gate");
  }
  if (!undoRoute.includes("requireTenantRoleIn(FINANCE_SECTION_ROLES)")) {
    throw new Error("undo-remit route missing FINANCE_SECTION_ROLES gate");
  }
  console.log("OK: local route files reference atomic RPCs");
}

async function assertSupabaseRpcSurface(
  url: string,
  serviceKey: string,
  label: string,
) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error: remitError } = await admin.rpc("remit_tax_for_period", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_period_month: null,
    p_kind: null,
    p_view_all_business_units: false,
  });
  if (!remitError || !/tenant is required/i.test(remitError.message)) {
    throw new Error(
      `${label}: Supabase remit_tax_for_period surface failed: ${remitError?.message ?? "no error"}`,
    );
  }

  const { error: undoError } = await admin.rpc("undo_remit_tax_for_period", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_period_month: null,
    p_kind: null,
  });
  if (!undoError || !/tenant is required/i.test(undoError.message)) {
    throw new Error(
      `${label}: Supabase undo_remit_tax_for_period surface failed: ${undoError?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-281 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-281-staging-verified",
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
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 281 atomic tax remit ===`);
    console.log(`ref=${expectedRef}`);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (
        !sql.includes("remit_tax_for_period") ||
        !sql.includes("undo_remit_tax_for_period")
      ) {
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
    console.log(
      "\nOK: expense_register / tax_ledger_entries / tax_settings unchanged (function-only migration)",
    );

    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertRouteReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 281 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
