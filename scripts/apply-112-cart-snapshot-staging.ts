/**
 * Apply scripts/112_product_sale_payment_request_cart_snapshot.sql to staging.
 * Usage: npx tsx scripts/apply-112-cart-snapshot-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

loadEnvFile(resolve(process.cwd(), ".env.staging.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error("Refusing non-staging");
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL not configured");
}

async function main() {
  const sqlText = readFileSync(
    resolve(process.cwd(), "scripts/112_product_sale_payment_request_cart_snapshot.sql"),
    "utf8",
  );
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sqlText);
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_sale_payment_requests'
        AND column_name = 'cart_snapshot'
    `);
    const checks = await client.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.product_sale_payment_requests'::regclass
        AND contype = 'c'
      ORDER BY conname
    `);
    console.log(
      JSON.stringify(
        {
          cart_snapshot: cols.rows[0] ?? null,
          check_constraints: checks.rows.map((r: Record<string, unknown>) => r.conname),
        },
        null,
        2,
      ),
    );
    if (!cols.rows[0]) {
      throw new Error("cart_snapshot column missing");
    }
    console.log("PASS: cart_snapshot applied on staging");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
