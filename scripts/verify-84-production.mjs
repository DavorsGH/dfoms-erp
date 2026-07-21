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

loadEnvForce(resolve(process.cwd(), ".env.local.backup"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error("Refusing to run: expected production project tvcurcnmasnocwdxzgvz");
}

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

const candidates = [];
const rawUrl = process.env.DATABASE_URL;
if (rawUrl) {
  candidates.push(rawUrl, rebuildUrl(rawUrl));
}
if (process.env.SUPABASE_DB_PASSWORD && supabaseUrl) {
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  const password = process.env.SUPABASE_DB_PASSWORD;
  candidates.push(
    `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
  );
  candidates.push(
    `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
  );
}

const { default: pg } = await import("pg");
let lastError;

console.log("Target: PRODUCTION (tvcurcnmasnocwdxzgvz)\n");

for (const connectionString of [...new Set(candidates.filter(Boolean))]) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();

    const projectCheck = await client.query(`
      SELECT current_database() AS db, inet_server_addr()::text AS host
    `);
    console.log("Connected:", projectCheck.rows[0]);
    console.log();

    const enumResult = await client.query(`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (
        SELECT udt_name::regtype FROM information_schema.columns
        WHERE table_name = 'stock_movements' AND column_name = 'movement_type'
      )
      ORDER BY enumlabel
    `);

    const tablesResult = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('suppliers', 'product_purchases')
      ORDER BY table_name
    `);

    const columnsResult = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'finished_products' AND column_name IN ('sourcing_type', 'supplier_id')
      ORDER BY column_name
    `);

    const procsResult = await client.query(`
      SELECT proname FROM pg_proc
      WHERE proname IN ('create_product_purchase', 'create_product_sale', 'finished_product_weighted_avg_cost')
      ORDER BY proname
    `);

    await client.end();

    console.log("=== movement_type enum labels ===");
    console.table(enumResult.rows);
    console.log("=== tables (suppliers, product_purchases) ===");
    console.table(tablesResult.rows);
    console.log("=== finished_products columns ===");
    console.table(columnsResult.rows);
    console.log("=== functions ===");
    console.table(procsResult.rows);
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

throw lastError ?? new Error("No database connection candidate worked");
