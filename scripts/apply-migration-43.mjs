import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
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
    const script43 = readFileSync(
      resolve(process.cwd(), "scripts/43_void_product_sale.sql"),
      "utf8",
    );

    await runSql(client, "43_void_product_sale.sql", script43);

    const verification = await client.query(`
      SELECT
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'income_register'
            AND column_name = 'sale_status'
        ) AS sale_status_exists,
        EXISTS (
          SELECT 1
          FROM pg_proc
          WHERE proname = 'void_product_sale'
        ) AS void_rpc_exists;
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
