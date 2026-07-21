import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  throw new Error("Expected production project tvcurcnmasnocwdxzgvz");
}

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const password = decodeURIComponent(parsed.password);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

const candidates = [];
if (process.env.DATABASE_URL) {
  candidates.push(process.env.DATABASE_URL);
  candidates.push(rebuildUrl(process.env.DATABASE_URL));
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
let client;
let lastError;

for (const connectionString of [...new Set(candidates)]) {
  client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(`
      SELECT 'client_invoices' AS table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'client_invoices'
      UNION ALL
      SELECT 'income_register', column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'income_register'
      ORDER BY table_name, column_name
    `);
    console.table(rows);
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      // ignore cleanup errors
    }
  }
}

throw lastError ?? new Error("No database connection candidate worked");
