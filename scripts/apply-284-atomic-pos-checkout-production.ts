/**
 * Apply scripts/284_atomic_pos_checkout.sql
 *
 * Usage:
 *   npx tsx scripts/apply-284-atomic-pos-checkout-production.ts --env staging --confirm-284
 *   npx tsx scripts/apply-284-atomic-pos-checkout-production.ts --env production --confirm-284 --confirm-284-staging-verified
 *   npx tsx scripts/apply-284-atomic-pos-checkout-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/284_atomic_pos_checkout.sql";

const PUBLIC_RPCS = ["checkout_pos_cart"] as const;

const PRIVATE_HELPERS = [
  "_pos_round_money",
  "_pos_build_notes",
  "_pos_pick_tax_settings",
  "_pos_product_sale_tax_rate",
  "_pos_compute_vfrs_output_tax",
  "_pos_sync_vfrs_for_income_id",
  "_pos_sync_vfrs_for_income_ids",
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
    confirm: argv.includes("--confirm-284"),
    confirmStagingVerified: argv.includes("--confirm-284-staging-verified"),
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
    if (!/create_product_sale/i.test(src)) {
      throw new Error(`${label}: checkout_pos_cart missing create_product_sale call`);
    }
    if (!/Checkout failed on line/i.test(src)) {
      throw new Error(`${label}: checkout_pos_cart missing line-specific error wrapper`);
    }
    await assertRpcGrants(client, fn);
    console.log(
      `${label}: OK ${fn} (SECURITY DEFINER, authenticated+service_role EXECUTE, PUBLIC revoked)`,
    );
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
  const checkoutFail = await client
    .query(
      `
    SELECT public.checkout_pos_cart(
      NULL::uuid,
      NULL::uuid,
      NULL::date,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::date,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::numeric,
      '[]'::jsonb
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!checkoutFail.ok || !/tenant is required/i.test(checkoutFail.message)) {
    throw new Error(
      `${label}: checkout_pos_cart callable check failed: ${checkoutFail.message}`,
    );
  }
  console.log(`${label}: OK checkout_pos_cart callable (validation guard)`);
}

async function assertComponentReferences() {
  const posUtils = readFileSync(
    resolve("app/dashboard/pos/pos-utils.ts"),
    "utf8",
  );
  const momo = readFileSync(
    resolve("utils/pos-momo-fulfillment.ts"),
    "utf8",
  );

  if (!posUtils.includes('rpc("checkout_pos_cart"')) {
    throw new Error("pos-utils.ts does not call checkout_pos_cart RPC");
  }
  if (!momo.includes('rpc("checkout_pos_cart"')) {
    throw new Error("pos-momo-fulfillment.ts does not call checkout_pos_cart RPC");
  }
  console.log("OK: local POS files reference checkout_pos_cart RPC");
}

async function assertSupabaseRpcSurface(
  url: string,
  serviceKey: string,
  label: string,
) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await admin.rpc("checkout_pos_cart", {
    p_tenant_id: null,
    p_business_unit_id: null,
    p_sale_date: null,
    p_invoice_no: null,
    p_client_id: null,
    p_customer_name: null,
    p_payment_status: null,
    p_due_date: null,
    p_notes: null,
    p_payment_method: null,
    p_sales_rep_id: null,
    p_amount_received: null,
    p_lines: [],
  });
  if (!error || !/tenant is required/i.test(error.message)) {
    throw new Error(
      `${label}: Supabase checkout_pos_cart surface failed: ${error?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-284 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-284-staging-verified",
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
    console.log(`=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 284 atomic POS checkout ===`);
    console.log(`ref=${expectedRef}`);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (!sql.includes("checkout_pos_cart")) {
        throw new Error("SQL file missing checkout_pos_cart");
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

    console.log(`\n=== ${label} 284 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
