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
  resolve(process.cwd(), "../../06 Database/105_departments_tenant_pk.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log(`Applying 105_departments_tenant_pk.sql to ${projectRef}...`);
await client.query(sql);
await client.query(`NOTIFY pgrst, 'reload schema'`);
console.log("SUCCESS (schema reload notified).");

const pk = await client.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'public.departments'::regclass AND contype = 'p'
`);
console.log("departments PK:", pk.rows);

const fks = await client.query(`
  SELECT con.conname, con.conrelid::regclass::text AS from_table,
         pg_get_constraintdef(con.oid) AS def
  FROM pg_constraint con
  WHERE con.contype = 'f' AND con.confrelid = 'public.departments'::regclass
  ORDER BY 2, 1
`);
console.log("inbound FKs:", fks.rows);

await client.end();
