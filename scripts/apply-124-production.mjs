/**
 * Apply 124_staff_id_plain_format.sql to PRODUCTION only.
 * Does NOT allocate sequence numbers.
 *
 * Usage: node scripts/apply-124-production.mjs
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
  resolve(process.cwd(), "../../06 Database/124_staff_id_plain_format.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
let lastError;

for (const connectionString of [...new Set(candidates.filter(Boolean))]) {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    await client.connect();
    console.log("Confirmed project: tvcurcnmasnocwdxzgvz");
    console.log("Running 124_staff_id_plain_format.sql on PRODUCTION...\n");
    await client.query(sql);

    const def = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'generate_next_code'
    `);
    const body = def.rows[0]?.def ?? "";
    console.log("STAFF plain branch present:", body.includes("v_entity = 'STAFF'"));
    console.log(
      "Default branded return present:",
      body.includes("|| '-' || v_entity || '-' ||"),
    );
    console.log("SUCCESS: function replaced (no sequence allocation).");
    await client.end();
    process.exit(0);
  } catch (error) {
    lastError = error;
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

console.error("FAILED to connect/apply:", lastError?.message ?? lastError);
process.exit(1);
