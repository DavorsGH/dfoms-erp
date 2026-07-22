/**
 * Apply 102_tenant_code_and_id_sequences.sql to PRODUCTION only.
 * Does NOT run generate_next_code smoke allocations.
 *
 * Usage: node scripts/apply-102-production.mjs
 */
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
  throw new Error(
    `REFUSING: expected production tvcurcnmasnocwdxzgvz, got ${supabaseUrl}`,
  );
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
    `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
  );
}

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/102_tenant_code_and_id_sequences.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
let lastError;
const notices = [];

for (const connectionString of [...new Set(candidates.filter(Boolean))]) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  client.on("notice", (msg) => {
    notices.push(msg.message ?? String(msg));
    console.log("NOTICE:", msg.message ?? msg);
  });

  try {
    await client.connect();
    console.log("Confirmed project: tvcurcnmasnocwdxzgvz");
    console.log(
      "Running 102_tenant_code_and_id_sequences.sql on PRODUCTION...\n",
    );
    await client.query(sql);
    console.log("SUCCESS: transaction committed with no errors.");

    console.log("\n=== tenant_code values ===");
    const tenants = await client.query(
      `SELECT id::text, name, slug, tenant_code FROM tenants ORDER BY created_at`,
    );
    console.table(tenants.rows);

    console.log("\n=== objects created ===");
    const seqTable = await client.query(
      `SELECT to_regclass('public.id_sequences')::text AS id_sequences`,
    );
    const fn = await client.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'generate_next_code'
    `);
    console.log("id_sequences:", seqTable.rows[0]?.id_sequences);
    console.log("generate_next_code args:", fn.rows);

    if (notices.length === 0) {
      console.log("\nNo NOTICE messages emitted.");
    } else {
      console.log("\nNOTICE messages:", notices);
    }

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
