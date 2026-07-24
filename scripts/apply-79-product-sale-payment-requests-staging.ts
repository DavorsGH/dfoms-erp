/**
 * Apply scripts/79_product_sale_payment_requests.sql to staging and verify.
 * Usage: npx tsx scripts/apply-79-product-sale-payment-requests-staging.ts
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
  throw new Error("DATABASE_URL not configured for staging");
}

async function main() {
  const sqlPath = resolve(
    process.cwd(),
    "scripts/79_product_sale_payment_requests.sql",
  );
  const sqlText = readFileSync(sqlPath, "utf8");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(sqlText);

    const table = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_sale_payment_requests'
      ORDER BY ordinal_position
    `);

    const rls = await client.query(`
      SELECT c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'product_sale_payment_requests'
    `);

    const policies = await client.query(`
      SELECT polname
      FROM pg_policy
      WHERE polrelid = 'public.product_sale_payment_requests'::regclass
      ORDER BY polname
    `);

    const trigger = await client.query(`
      SELECT tgname
      FROM pg_trigger
      WHERE tgrelid = 'public.product_sale_payment_requests'::regclass
        AND NOT tgisinternal
      ORDER BY tgname
    `);

    console.log(
      JSON.stringify(
        {
          columns: table.rows.length,
          column_names: table.rows.map((r) => r.column_name),
          rls_enabled: rls.rows[0]?.rls_enabled ?? false,
          policies: policies.rows.map((r) => r.polname),
          triggers: trigger.rows.map((r) => r.tgname),
        },
        null,
        2,
      ),
    );

    if (table.rows.length < 20) {
      throw new Error(`Expected >= 20 columns, got ${table.rows.length}`);
    }
    if (!rls.rows[0]?.rls_enabled) {
      throw new Error("RLS not enabled");
    }
    if (policies.rows.length < 4) {
      throw new Error(`Expected >= 4 policies, got ${policies.rows.length}`);
    }

    console.log("PASS: product_sale_payment_requests applied on staging");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
