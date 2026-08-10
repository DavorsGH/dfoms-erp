/**
 * Apply 201_customer_type_all_and_product_client.sql to staging with verification.
 * Usage: node scripts/apply-201-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) throw new Error("DATABASE_URL missing");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== "wieflwbfdmjtsdnwbfii") {
  throw new Error(
    `REFUSING: expected staging wieflwbfdmjtsdnwbfii, got ${projectRef}`,
  );
}

const sql = readFileSync(
  resolve(process.cwd(), "scripts/201_customer_type_all_and_product_client.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

async function countCustomerType(value) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM public.customers WHERE customer_type = $1`,
    [value],
  );
  return rows[0]?.count ?? 0;
}

const bothBefore = await countCustomerType("both");
const allBefore = await countCustomerType("all");
console.log("BEFORE both:", bothBefore);
console.log("BEFORE all:", allBefore);

console.log(`Applying 201 to ${projectRef}...`);
await client.query(sql);
console.log("SUCCESS (schema reload notified).");

const bothAfter = await countCustomerType("both");
const allAfter = await countCustomerType("all");
console.log("AFTER both:", bothAfter);
console.log("AFTER all:", allAfter);

if (bothAfter !== 0) {
  throw new Error(`Expected 0 rows with customer_type=both, got ${bothAfter}`);
}
if (allAfter !== allBefore + bothBefore) {
  throw new Error(
    `Expected all count ${allBefore + bothBefore}, got ${allAfter}`,
  );
}

const { rows: constraintRows } = await client.query(`
  SELECT pg_get_constraintdef(c.oid) AS definition
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'customers'
    AND c.conname = 'customers_customer_type_check'
`);
console.log("CONSTRAINT:", constraintRows[0]?.definition ?? "(not found)");

await client.end();
