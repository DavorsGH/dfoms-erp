/**
 * Apply scripts/257_phase5c_business_unit_stamp.sql to staging.
 * Probes live signatures before/after (same caution as 255/256).
 *
 * Usage: npx tsx scripts/apply-257-phase5c-bu-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_PROJECT_REF = "wieflwbfdmjtsdnwbfii";

const RPC_NAMES = [
  "create_purchase_order",
  "create_production_batch",
  "create_product_purchase",
  "post_raw_material_purchase_finance",
  "create_raw_material_purchase_payable",
  "create_product_purchase_payable",
  "create_fixed_asset_payable",
  "replace_income_register_tax_ledger_entries",
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

async function listOverloads(client: pg.Client, names: string[]) {
  const { rows } = await client.query(
    `
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
      ORDER BY p.proname, p.oid
    `,
    [names],
  );
  return rows as Array<{ proname: string; args: string }>;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
    throw new Error(`Expected staging project ${STAGING_PROJECT_REF}`);
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL not configured for staging");
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const before = await listOverloads(client, [...RPC_NAMES]);
    console.log("--- before ---");
    for (const row of before) {
      console.log(`${row.proname}(${row.args})`);
    }

    for (const name of [
      "create_purchase_order",
      "create_production_batch",
      "create_product_purchase",
    ] as const) {
      const rows = before.filter((r) => r.proname === name);
      if (rows.length === 0) {
        throw new Error(`${name} not found on staging — refuse to apply`);
      }
    }

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/257_phase5c_business_unit_stamp.sql"),
      "utf8",
    );
    console.log("Applying 257_phase5c_business_unit_stamp.sql …");
    await client.query(sql);

    const after = await listOverloads(client, [...RPC_NAMES]);
    console.log("--- after ---");
    for (const row of after) {
      console.log(`${row.proname}(${row.args})`);
    }

    const expectBu = [
      "create_purchase_order",
      "create_production_batch",
      "create_product_purchase",
    ] as const;
    for (const name of expectBu) {
      const rows = after.filter((r) => r.proname === name);
      if (rows.length !== 1) {
        throw new Error(
          `Expected exactly 1 ${name} overload, got ${rows.length}`,
        );
      }
      if (!rows[0].args.includes("p_business_unit_id")) {
        throw new Error(`${name} missing p_business_unit_id`);
      }
    }

    const { rows: defRows } = await client.query(`
      SELECT p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'post_raw_material_purchase_finance',
          'create_raw_material_purchase_payable',
          'create_product_purchase_payable',
          'create_fixed_asset_payable',
          'replace_income_register_tax_ledger_entries'
        )
      ORDER BY p.proname, p.oid
    `);

    for (const row of defRows as Array<{ proname: string; def: string }>) {
      if (!row.def.includes("business_unit_id")) {
        throw new Error(`${row.proname} body missing business_unit_id`);
      }
      console.log(`OK body: ${row.proname}`);
    }

    console.log("PASS: 257 applied on staging.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
