import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function runSql(client, label, sql) {
  console.log(`\nApplying ${label}...`);
  await client.query(sql);
  console.log(`Applied ${label}.`);
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL;

  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL (or SUPABASE_DB_URL / POSTGRES_URL) is required in .env.local to apply migrations.",
    );
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const script41 = readFileSync(
      resolve(process.cwd(), "scripts/41_inventory_balance_sheet.sql"),
      "utf8",
    );

    await runSql(client, "41_inventory_balance_sheet.sql", script41);

    const verification = await client.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND table_name = 'inventory_balance_config'
        ) AS inventory_balance_config_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc
          WHERE proname = 'calculate_live_inventory_value'
        ) AS calculate_live_inventory_value_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc
          WHERE proname = 'post_raw_material_purchase_finance'
        ) AS post_raw_material_purchase_finance_exists,
        EXISTS (
          SELECT 1
          FROM pg_trigger
          WHERE tgname = 'trg_post_raw_material_purchase_finance'
        ) AS trg_post_raw_material_purchase_finance_exists,
        (
          SELECT is_nullable
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'raw_material_purchases'
            AND column_name = 'payment_method'
        ) AS payment_method_nullable,
        (
          SELECT go_live_date::text
          FROM inventory_balance_config
          WHERE id = 1
        ) AS go_live_date,
        (
          SELECT opening_inventory_value::text
          FROM inventory_balance_config
          WHERE id = 1
        ) AS opening_inventory_value;
    `);

    console.log("\nVerification:", verification.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
