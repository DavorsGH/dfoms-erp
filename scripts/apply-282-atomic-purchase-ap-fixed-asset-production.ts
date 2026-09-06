/**
 * Apply scripts/282_atomic_purchase_ap_fixed_asset.sql
 *
 * Usage:
 *   npx tsx scripts/apply-282-atomic-purchase-ap-fixed-asset-production.ts --env staging --confirm-282
 *   npx tsx scripts/apply-282-atomic-purchase-ap-fixed-asset-production.ts --env production --confirm-282 --confirm-282-staging-verified
 *   npx tsx scripts/apply-282-atomic-purchase-ap-fixed-asset-production.ts --env production --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const SQL_FILE = "scripts/282_atomic_purchase_ap_fixed_asset.sql";

const PUBLIC_RPCS = [
  "replace_purchase_tax_ledger_entries",
  "save_accounts_payable",
  "delete_accounts_payable",
  "save_fixed_asset",
  "delete_fixed_asset",
] as const;

const PRIVATE_HELPERS = [
  "_pur_round_currency",
  "_pur_normalize_category",
  "_pur_is_fixed_asset_credit_payable",
  "_pur_is_statutory_remittance_payable",
  "_pur_should_post_ap_accrual",
  "_pur_ap_accrual_receipt_no",
  "_pur_ap_accrual_description",
  "_pur_resolve_accrual_payment_status",
  "_pur_lookup_purchase_source_context",
  "_pur_lookup_purchase_business_unit_id",
  "_pur_delete_tax_ledger_for_source",
  "_pur_delete_ap_accrual_expense",
  "_pur_post_ap_accrual_expense",
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
    confirm: argv.includes("--confirm-282"),
    confirmStagingVerified: argv.includes("--confirm-282-staging-verified"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

type DataSnapshot = {
  accounts_payable_count: number;
  accounts_payable_amount_sum: string;
  fixed_assets_count: number;
  fixed_assets_total_cost_sum: string;
  expense_register_count: number;
  expense_register_amount_sum: string;
  tax_ledger_entries_count: number;
  tax_ledger_entries_tax_sum: string;
};

async function captureDataSnapshot(client: pg.Client): Promise<DataSnapshot> {
  const { rows } = await client.query<DataSnapshot>(`
    SELECT
      (SELECT count(*)::int FROM accounts_payable) AS accounts_payable_count,
      (SELECT coalesce(sum(amount), 0)::text FROM accounts_payable) AS accounts_payable_amount_sum,
      (SELECT count(*)::int FROM fixed_assets) AS fixed_assets_count,
      (SELECT coalesce(sum(total_cost), 0)::text FROM fixed_assets) AS fixed_assets_total_cost_sum,
      (SELECT count(*)::int FROM expense_register) AS expense_register_count,
      (SELECT coalesce(sum(amount), 0)::text FROM expense_register) AS expense_register_amount_sum,
      (SELECT count(*)::int FROM tax_ledger_entries) AS tax_ledger_entries_count,
      (SELECT coalesce(sum(tax_amount), 0)::text FROM tax_ledger_entries) AS tax_ledger_entries_tax_sum
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
    if (
      fn === "save_accounts_payable" &&
      !/_pur_post_ap_accrual_expense/i.test(src)
    ) {
      throw new Error(`${label}: save_accounts_payable missing accrual helper call`);
    }
    if (
      fn === "save_accounts_payable" &&
      !/replace_purchase_tax_ledger_entries/i.test(src)
    ) {
      throw new Error(`${label}: save_accounts_payable missing tax replace call`);
    }
    if (
      fn === "save_fixed_asset" &&
      !/sync_fixed_asset_payable/i.test(src)
    ) {
      throw new Error(`${label}: save_fixed_asset missing payable sync call`);
    }
    if (
      fn === "delete_fixed_asset" &&
      !/reverse_fixed_asset_payable/i.test(src)
    ) {
      throw new Error(`${label}: delete_fixed_asset missing payable reverse call`);
    }
    await assertRpcGrants(client, fn);
    console.log(
      `${label}: OK ${fn} (SECURITY DEFINER, authenticated+service_role EXECUTE)`,
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
  const replaceFail = await client
    .query(
      `SELECT public.replace_purchase_tax_ledger_entries(NULL::text, NULL::text, '[]'::jsonb)`,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!replaceFail.ok || !/source_type|source_id|invalid/i.test(replaceFail.message)) {
    throw new Error(
      `${label}: replace_purchase_tax_ledger_entries callable check failed: ${replaceFail.message}`,
    );
  }
  console.log(`${label}: OK replace_purchase_tax_ledger_entries callable (validation guard)`);

  const saveApFail = await client
    .query(
      `
    SELECT public.save_accounts_payable(
      NULL::uuid, NULL::uuid, NULL::uuid,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::date, NULL::date,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::text,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
      NULL::text, NULL::text, '[]'::jsonb
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!saveApFail.ok || !/tenant is required/i.test(saveApFail.message)) {
    throw new Error(
      `${label}: save_accounts_payable callable check failed: ${saveApFail.message}`,
    );
  }
  console.log(`${label}: OK save_accounts_payable callable (validation guard)`);

  const deleteApFail = await client
    .query(`SELECT public.delete_accounts_payable(NULL::uuid, NULL::uuid)`)
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!deleteApFail.ok || !/tenant is required/i.test(deleteApFail.message)) {
    throw new Error(
      `${label}: delete_accounts_payable callable check failed: ${deleteApFail.message}`,
    );
  }
  console.log(`${label}: OK delete_accounts_payable callable (validation guard)`);

  const saveFaFail = await client
    .query(
      `
    SELECT public.save_fixed_asset(
      NULL::uuid, NULL::text, false, NULL::uuid,
      NULL::text, NULL::text, NULL::date,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::text,
      NULL::numeric, NULL::numeric, NULL::numeric,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric,
      NULL::uuid, '[]'::jsonb
    )
    `,
    )
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!saveFaFail.ok || !/tenant is required/i.test(saveFaFail.message)) {
    throw new Error(
      `${label}: save_fixed_asset callable check failed: ${saveFaFail.message}`,
    );
  }
  console.log(`${label}: OK save_fixed_asset callable (validation guard)`);

  const deleteFaFail = await client
    .query(`SELECT public.delete_fixed_asset(NULL::uuid, NULL::text)`)
    .then(
      () => ({ ok: false, message: "expected validation failure" }),
      (err: Error) => ({ ok: true, message: err.message }),
    );
  if (!deleteFaFail.ok || !/tenant is required/i.test(deleteFaFail.message)) {
    throw new Error(
      `${label}: delete_fixed_asset callable check failed: ${deleteFaFail.message}`,
    );
  }
  console.log(`${label}: OK delete_fixed_asset callable (validation guard)`);
}

async function assertComponentReferences() {
  const apComponent = readFileSync(
    resolve("app/dashboard/finance/accounts-payable.tsx"),
    "utf8",
  );
  const faComponent = readFileSync(
    resolve("app/dashboard/finance/fixed-assets.tsx"),
    "utf8",
  );
  const taxSync = readFileSync(
    resolve("app/dashboard/finance/tax-ledger-sync.ts"),
    "utf8",
  );

  if (!apComponent.includes('rpc("save_accounts_payable"')) {
    throw new Error("accounts-payable.tsx does not call save_accounts_payable RPC");
  }
  if (!apComponent.includes('rpc("delete_accounts_payable"')) {
    throw new Error("accounts-payable.tsx does not call delete_accounts_payable RPC");
  }
  if (apComponent.includes("postAccountsPayableAccrualExpense(")) {
    throw new Error("accounts-payable.tsx still calls legacy accrual util");
  }
  if (!faComponent.includes('rpc("save_fixed_asset"')) {
    throw new Error("fixed-assets.tsx does not call save_fixed_asset RPC");
  }
  if (!faComponent.includes('rpc("delete_fixed_asset"')) {
    throw new Error("fixed-assets.tsx does not call delete_fixed_asset RPC");
  }
  if (!taxSync.includes('rpc("replace_purchase_tax_ledger_entries"')) {
    throw new Error("tax-ledger-sync.ts does not call replace_purchase_tax_ledger_entries RPC");
  }
  console.log("OK: local component files reference atomic RPCs");
}

async function assertSupabaseRpcSurface(
  url: string,
  serviceKey: string,
  label: string,
) {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { error: replaceError } = await admin.rpc(
    "replace_purchase_tax_ledger_entries",
    {
      p_source_type: null,
      p_source_id: null,
      p_rows: [],
    },
  );
  if (!replaceError || !/source_type|source_id|invalid/i.test(replaceError.message)) {
    throw new Error(
      `${label}: Supabase replace_purchase_tax_ledger_entries surface failed: ${replaceError?.message ?? "no error"}`,
    );
  }

  const { error: saveApError } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: null,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: null,
    p_invoice_number: null,
    p_expense_category: null,
    p_sub_category: null,
    p_description: null,
    p_invoice_date: null,
    p_due_date: null,
    p_amount: null,
    p_amount_paid: null,
    p_balance_due: null,
    p_status: null,
    p_gross_before_wht: null,
    p_wht_rate: null,
    p_wht_amount: null,
    p_input_vat_amount: null,
    p_net_of_tax_amount: null,
    p_notes: null,
    p_source_type: null,
    p_tax_rows: [],
  });
  if (!saveApError || !/tenant is required/i.test(saveApError.message)) {
    throw new Error(
      `${label}: Supabase save_accounts_payable surface failed: ${saveApError?.message ?? "no error"}`,
    );
  }

  console.log(`${label}: OK Supabase JS RPC surface callable (validation guard)`);
}

async function main() {
  const { environment, confirm, confirmStagingVerified, verifyOnly } =
    parseArgs(process.argv.slice(2));

  if (!confirm && !verifyOnly) {
    throw new Error("Pass --confirm-282 (or --verify-only)");
  }
  if (environment === "production" && !verifyOnly && !confirmStagingVerified) {
    throw new Error(
      "Production apply requires --confirm-282-staging-verified",
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
    console.log(
      `=== ${label} ${verifyOnly ? "VERIFY" : "APPLY"} 282 atomic purchase AP/FA ===`,
    );
    console.log(`ref=${expectedRef}`);

    const before = await captureDataSnapshot(client);
    console.log("\n=== DATA SNAPSHOT (before) ===");
    console.log(before);

    if (!verifyOnly) {
      const sql = readFileSync(resolve(SQL_FILE), "utf8");
      if (
        !sql.includes("replace_purchase_tax_ledger_entries") ||
        !sql.includes("save_accounts_payable")
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
      "\nOK: accounts_payable / fixed_assets / expense_register / tax_ledger_entries unchanged (function-only migration)",
    );

    await assertFunctions(client, label);
    await assertCallableWithoutMutation(client, label);
    await assertComponentReferences();
    await assertSupabaseRpcSurface(supabaseUrl, serviceKey, label);

    console.log(`\n=== ${label} 282 PRODUCTION READY ===`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
