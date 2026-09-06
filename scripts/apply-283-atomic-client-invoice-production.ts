/**
 * Apply scripts/283_atomic_client_invoice.sql
 *
 * Requires script 280 (_cip_* helpers) on the target database.
 *
 * Usage:
 *   npx tsx scripts/apply-283-atomic-client-invoice-production.ts --env staging --confirm-283
 *   npx tsx scripts/apply-283-atomic-client-invoice-production.ts --env production --confirm-283 --confirm-283-staging-verified
 *   npx tsx scripts/apply-283-atomic-client-invoice-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/283_atomic_client_invoice.sql";

const PUBLIC_RPCS = [
  "save_client_invoice",
  "change_client_invoice_status",
  "void_client_invoice",
] as const;

const PRIVATE_HELPERS = [
  "_ci_line_total_cost",
  "_ci_is_line_taxed",
  "_ci_load_sales_tax_basis",
  "_ci_compute_invoice_totals",
  "_ci_next_invoice_sequence",
  "_ci_replace_line_items",
  "_ci_replace_payment_accounts",
  "_ci_status_transition_allowed",
] as const;

const SCRIPT_280_HELPERS = [
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

const SCRIPT_280_PUBLIC_RPCS = [
  "record_client_invoice_payment",
  "void_client_invoice_payment",
] as const;

type DataSnapshot = {
  client_invoices_count: number;
  client_invoices_total_due_sum: string;
  client_invoice_line_items_count: number;
  income_register_count: number;
  income_register_amount_sum: string;
  tax_ledger_entries_count: number;
  tax_ledger_entries_tax_sum: string;
  finished_products_count: number;
  finished_products_stock_sum: string;
  finished_product_balances_count: number;
  finished_product_balances_stock_sum: string;
  product_sale_payment_requests_count: number;
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
    confirm: argv.includes("--confirm-283"),
    confirmStagingVerified: argv.includes("--confirm-283-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM client_invoices) AS client_invoices_count,
      (SELECT coalesce(sum(total_amount_due), 0)::text FROM client_invoices) AS client_invoices_total_due_sum,
      (SELECT count(*)::int FROM client_invoice_line_items) AS client_invoice_line_items_count,
      (SELECT count(*)::int FROM income_register) AS income_register_count,
      (SELECT coalesce(sum(amount), 0)::text FROM income_register) AS income_register_amount_sum,
      (SELECT count(*)::int FROM tax_ledger_entries) AS tax_ledger_entries_count,
      (SELECT coalesce(sum(tax_amount), 0)::text FROM tax_ledger_entries) AS tax_ledger_entries_tax_sum,
      (SELECT count(*)::int FROM finished_products) AS finished_products_count,
      (SELECT coalesce(sum(current_stock), 0)::text FROM finished_products) AS finished_products_stock_sum,
      (SELECT count(*)::int FROM finished_product_balances) AS finished_product_balances_count,
      (SELECT coalesce(sum(current_stock), 0)::text FROM finished_product_balances) AS finished_product_balances_stock_sum,
      (SELECT count(*)::int FROM product_sale_payment_requests) AS product_sale_payment_requests_count
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

  const authenticatedExec = grants.some(
    (g) =>
      g.grantee === "authenticated" &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  const serviceRoleExec = grants.some(
    (g) =>
      g.grantee === "service_role" &&
      g.privilege_type.toUpperCase() === "EXECUTE",
  );
  if (!authenticatedExec) {
    throw new Error(`${fn}: authenticated missing EXECUTE`);
  }
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

async function assertScript280Dependency(client: pg.Client, label: string) {
  console.log(`\n=== ${label} script 280 dependency check ===`);
  for (const fn of SCRIPT_280_PUBLIC_RPCS) {
    await assertFunctionExists(client, fn, label);
    console.log(`${label}: OK script 280 RPC ${fn}`);
  }
  for (const fn of SCRIPT_280_HELPERS) {
    await assertFunctionExists(client, fn, label);
    console.log(`${label}: OK script 280 helper ${fn}`);
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
      fn === "save_client_invoice" &&
      !/_cip_sync_income_register_from_client_invoice/i.test(src)
    ) {
      throw new Error(`${label}: save_client_invoice missing income sync call`);
    }
    if (
      fn === "void_client_invoice" &&
      !/_cip_sync_income_register_from_client_invoice/i.test(src)
    ) {
      throw new Error(`${label}: void_client_invoice missing income sync call`);
    }
    await assertRpcGrants(client, fn);
    console.log(
      `${label}: OK ${fn} (SECURITY DEFINER, authenticated+service_role EXECUTE, PUBLIC revoked)`,
    );
  }

  for (const fn of PRIVATE_HELPERS) {
    await assertFunctionExists(client, fn, label);
    console.log(`${label}: OK helper ${fn}`);
  }
}

async function assertCallableWithoutMutation(client: pg.Client, label: string) {
  const saveFail = await client
    .query(
      `
    SELECT public.save_client_invoice(
      NULL::uuid,
      NULL::uuid,
      NULL::uuid,
      '{}'::jsonb
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!saveFail.ok || !/tenant is required/i.test(saveFail.message)) {
    throw new Error(
      `${label}: save_client_invoice callable check failed: ${saveFail.message}`,
    );
  }
  console.log(`${label}: OK save_client_invoice callable (validation guard)`);

  const statusFail = await client
    .query(
      `
    SELECT public.change_client_invoice_status(
      NULL::uuid,
      NULL::uuid,
      NULL::text
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!statusFail.ok || !/tenant is required/i.test(statusFail.message)) {
    throw new Error(
      `${label}: change_client_invoice_status callable check failed: ${statusFail.message}`,
    );
  }
  console.log(`${label}: OK change_client_invoice_status callable (validation guard)`);

  const voidFail = await client
    .query(`SELECT public.void_client_invoice(NULL::uuid, NULL::uuid)`)
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!voidFail.ok || !/tenant is required/i.test(voidFail.message)) {
    throw new Error(
      `${label}: void_client_invoice callable check failed: ${voidFail.message}`,
    );
  }
  console.log(`${label}: OK void_client_invoice callable (validation guard)`);
}

async function assertComponentReferences() {
  const api = readFileSync(resolve("utils/client-invoices-api.ts"), "utf8");

  if (!api.includes('rpc("save_client_invoice"')) {
    throw new Error("client-invoices-api.ts does not call save_client_invoice RPC");
  }
  if (!api.includes('rpc("change_client_invoice_status"')) {
    throw new Error("client-invoices-api.ts does not call change_client_invoice_status RPC");
  }
  if (!api.includes('rpc("void_client_invoice"')) {
    throw new Error("client-invoices-api.ts does not call void_client_invoice RPC");
  }
  console.log("OK: local client-invoices-api.ts references atomic invoice RPCs");
}

async function assertSupabaseRpcSurface(
  url: string,
  serviceKey: string,
  label: string,
) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error: saveError } = await admin.rpc("save_client_invoice", {
    p_tenant_id: null,
    p_invoice_id: null,
    p_business_unit_id: null,
    p_payload: {},
  });
  if (!saveError || !/tenant is required/i.test(saveError.message)) {
    throw new Error(
      `${label}: Supabase save_client_invoice surface failed: ${saveError?.message ?? "no error"}`,
    );
  }

  const { error: statusError } = await admin.rpc("change_client_invoice_status", {
    p_tenant_id: null,
    p_invoice_id: null,
    p_next_status: null,
  });
  if (!statusError || !/tenant is required/i.test(statusError.message)) {
    throw new Error(
      `${label}: Supabase change_client_invoice_status surface failed: ${statusError?.message ?? "no error"}`,
    );
  }

  const { error: voidError } = await admin.rpc("void_client_invoice", {
    p_tenant_id: null,
    p_invoice_id: null,
  });
  if (!voidError || !/tenant is required/i.test(voidError.message)) {
    throw new Error(
      `${label}: Supabase void_client_invoice surface failed: ${voidError?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-283 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-283-staging-verified",
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
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 283 atomic client invoice ===`);
    console.log(`ref=${expectedRef}`);

    await assertScript280Dependency(client, label);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (
        !sql.includes("save_client_invoice") ||
        !sql.includes("change_client_invoice_status") ||
        !sql.includes("void_client_invoice")
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
    console.log("\nOK: financial table row counts/sums unchanged (function-only migration)");

    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertComponentReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 283 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
