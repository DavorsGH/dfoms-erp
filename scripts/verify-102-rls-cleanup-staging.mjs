import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

for (const line of readFileSync(
  resolve(process.cwd(), ".env.staging.local"),
  "utf8",
).split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const i = trimmed.indexOf("=");
  if (i === -1) continue;
  process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error(`REFUSING: not staging (${url})`);
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const davors = "00000001-0000-4000-8000-000000000001";
const before = await client.query(
  `SELECT next_value FROM id_sequences WHERE tenant_id = $1 AND entity_type = 'EMP'`,
  [davors],
);
console.log("before EMP next_value:", before.rows);

await client.query("BEGIN");
await client.query("SET LOCAL ROLE authenticated");
const upd = await client.query(
  `UPDATE id_sequences SET next_value = 999
   WHERE tenant_id = $1 AND entity_type = 'EMP'
   RETURNING *`,
  [davors],
);
console.log("authenticated UPDATE rowCount:", upd.rowCount, "returning:", upd.rows);
await client.query("ROLLBACK");

const after = await client.query(
  `SELECT next_value FROM id_sequences WHERE tenant_id = $1 AND entity_type = 'EMP'`,
  [davors],
);
console.log("after EMP next_value:", after.rows);
const pass =
  upd.rowCount === 0 &&
  after.rows[0]?.next_value === before.rows[0]?.next_value;
console.log(
  pass
    ? "PASS: update blocked (0 rows / value unchanged)"
    : "FAIL: authenticated update modified rows",
);

const policies = await client.query(`
  SELECT
    pol.polname,
    CASE pol.polcmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
    END AS cmd
  FROM pg_policy pol
  WHERE pol.polrelid = 'public.id_sequences'::regclass
`);
console.table(policies.rows);

const caanta = (
  await client.query(`SELECT id FROM tenants WHERE name = 'Caanta Market'`)
).rows[0].id;

await client.query(
  `DELETE FROM id_sequences
   WHERE (tenant_id = $1 AND entity_type = 'EMP')
      OR (tenant_id = $2 AND entity_type = 'WO')`,
  [davors, caanta],
);
console.log("Cleaned verification counters.");

const left = await client.query(`SELECT * FROM id_sequences`);
console.log("remaining id_sequences rows:", left.rows.length);

await client.end();
