/**
 * Apply 124_staff_id_plain_format.sql to STAGING only.
 * Usage: node scripts/apply-124-staging.mjs
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
  throw new Error(`REFUSING: expected staging wieflwbfdmjtsdnwbfii, got ${projectRef}`);
}

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/124_staff_id_plain_format.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 124_staff_id_plain_format.sql to ${projectRef}...`);
await client.query(sql);

const def = await client.query(`
  SELECT pg_get_functiondef(p.oid) AS def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_next_code'
`);
const body = def.rows[0]?.def ?? "";
console.log("STAFF plain branch present:", body.includes("v_entity = 'STAFF'"));
console.log("SUCCESS.");
await client.end();
