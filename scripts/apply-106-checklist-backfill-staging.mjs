/**
 * Apply 106_backfill_checklist_ids.sql to staging only.
 * Usage: node scripts/apply-106-checklist-backfill-staging.mjs
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
  resolve(process.cwd(), "../../06 Database/106_backfill_checklist_ids.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 106_backfill_checklist_ids.sql to ${projectRef}...`);

const before = await client.query(`
  SELECT checklist_id, tenant_id, inspection_date
  FROM public.inspection_summary
  ORDER BY inspection_date, checklist_id
`);
console.log("Before rows:", before.rows);

await client.query(sql);
await client.query(`NOTIFY pgrst, 'reload schema'`);
console.log("SUCCESS (schema reload notified).");

const after = await client.query(`
  SELECT checklist_id, tenant_id, inspection_date
  FROM public.inspection_summary
  ORDER BY inspection_date, checklist_id
`);
console.log("After rows:", after.rows);

const seq = await client.query(`
  SELECT tenant_id, entity_type, next_value
  FROM public.id_sequences
  WHERE entity_type = 'CHECKLIST'
  ORDER BY tenant_id
`);
console.log("id_sequences CHECKLIST:", seq.rows);

const fk = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conname = 'failed_inspections_checklist_id_fkey'
`);
console.log("FK restored:", fk.rows);

await client.end();
