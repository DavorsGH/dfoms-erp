/**
 * Apply scripts/280_atomic_client_invoice_payment.sql
 *
 * Usage:
 *   npx tsx scripts/apply-280-atomic-client-invoice-payment-production.ts --env staging --confirm-280
 *   npx tsx scripts/apply-280-atomic-client-invoice-payment-production.ts --env production --confirm-280 --confirm-280-staging-verified
 *   npx tsx scripts/apply-280-atomic-client-invoice-payment-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/280_atomic_client_invoice_payment.sql";

const PUBLIC_RPCS = [
  "record_client_invoice_payment",
  "void_client_invoice_payment",
] as const;

const PRIVATE_HELPERS = [
  "_cip_round_money",
  "_cip_nullable_text",
  "_cip_period_month",
  "_cip_net_cash_due",
  "_cip_cash_outstanding",
  "_cip_is_settled_from_payments",
  "_cip_derive_invoice_status_from_payments",
  "_cip_sum_client_invoice_payments",
  "_cip_calculate_income_outstanding",
  "_cip_find_client_invoice_income_register_id",
  "_cip_build_income_tax_ledger_rows",
  "_cip_sync_income_register_from_client_invoice",
  "_cip_recompute_client_invoice_from_payments",
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
    confirm: argv.includes("--confirm-280"),
    confirmStagingVerified: argv.includes("--confirm-280-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

type DataSnapshot = {
  client_invoice_payments: number;
  client_receipts: number;
  client_invoices: number;
  income_register: number;
  tax_ledger_entries: number;
};

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM client_invoice_payments) AS client_invoice_payments,
      (SELECT count(*)::int FROM client_receipts) AS client_receipts,
      (SELECT count(*)::int FROM client_invoices) AS client_invoices,
      (SELECT count(*)::int FROM income_register) AS income_register,
      (SELECT count(*)::int FROM tax_ledger_entries) AS tax_ledger_entries
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
      fn === "record_client_invoice_payment" &&
      !/_cip_recompute_client_invoice_from_payments/i.test(src)
    ) {
      throw new Error(`${label}: record_client_invoice_payment missing recompute call`);
    }
    if (
      fn === "void_client_invoice_payment" &&
      !/_cip_recompute_client_invoice_from_payments/i.test(src)
    ) {
      throw new Error(`${label}: void_client_invoice_payment missing recompute call`);
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
  const recordFail = await client
    .query(
      `
    SELECT public.record_client_invoice_payment(
      NULL::uuid,
      NULL::uuid,
      NULL::date,
      NULL::numeric,
      NULL::text,
      NULL::text,
      NULL::uuid
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!recordFail.ok || !/tenant_id is required/i.test(recordFail.message)) {
    throw new Error(
      `${label}: record_client_invoice_payment callable check failed: ${recordFail.message}`,
    );
  }
  console.log(`${label}: OK record_client_invoice_payment callable (validation guard)`);

  const voidFail = await client
    .query(
      `
    SELECT public.void_client_invoice_payment(
      NULL::uuid,
      NULL::uuid
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!voidFail.ok || !/tenant_id is required/i.test(voidFail.message)) {
    throw new Error(
      `${label}: void_client_invoice_payment callable check failed: ${voidFail.message}`,
    );
  }
  console.log(`${label}: OK void_client_invoice_payment callable (validation guard)`);
}

async function assertRouteReferences() {
  const paymentsRoute = readFileSync(
    resolve("app/api/client-invoices/[id]/payments/route.ts"),
    "utf8",
  );
  const voidRoute = readFileSync(
    resolve("app/api/client-invoice-payments/[paymentId]/void/route.ts"),
    "utf8",
  );

  if (!paymentsRoute.includes('admin.rpc("record_client_invoice_payment"')) {
    throw new Error("payments route does not call record_client_invoice_payment RPC");
  }
  if (paymentsRoute.includes("recordClientInvoicePayment(")) {
    throw new Error("payments route still calls legacy recordClientInvoicePayment util");
  }
  if (!voidRoute.includes('admin.rpc("void_client_invoice_payment"')) {
    throw new Error("void route does not call void_client_invoice_payment RPC");
  }
  if (!voidRoute.includes("requireTenantRoleIn(FINANCE_SECTION_ROLES)")) {
    throw new Error("void route missing FINANCE_SECTION_ROLES gate");
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

  const { error: recordError } = await admin.rpc("record_client_invoice_payment", {
    p_tenant_id: null,
    p_invoice_id: null,
    p_payment_date: null,
    p_amount: null,
    p_payment_method: null,
    p_notes: null,
    p_recorded_by: null,
  });
  if (!recordError || !/tenant_id is required/i.test(recordError.message)) {
    throw new Error(
      `${label}: Supabase record_client_invoice_payment surface failed: ${recordError?.message ?? "no error"}`,
    );
  }

  const { error: voidError } = await admin.rpc("void_client_invoice_payment", {
    p_tenant_id: null,
    p_payment_id: null,
  });
  if (!voidError || !/tenant_id is required/i.test(voidError.message)) {
    throw new Error(
      `${label}: Supabase void_client_invoice_payment surface failed: ${voidError?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-280 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-280-staging-verified",
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
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 280 atomic client invoice payment ===`);
    console.log(`ref=${expectedRef}`);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (
        !sql.includes("record_client_invoice_payment") ||
        !sql.includes("void_client_invoice_payment")
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
    console.log("\nOK: client invoice payment table row counts unchanged (function-only migration)");

    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertRouteReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 280 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
