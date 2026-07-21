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

loadEnvForce(resolve(process.cwd(), ".env.local"));

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: rebuildUrl(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const tenantId = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const fn = await client.query(`
  SELECT pg_get_function_result(p.oid) AS result_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'preview_supplier_delete' AND n.nspname = 'public'
`);
console.log("Return type:", fn.rows[0]?.result_type);

const cols = await client.query(`
  SELECT a.attname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_type t ON t.oid = p.prorettype
  JOIN pg_class c ON c.oid = t.typrelid
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE p.proname = 'preview_supplier_delete'
    AND n.nspname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY a.attnum
`);
console.log("Return columns:", cols.rows.map((row) => row.attname));

const inserted = await client.query(
  `
  INSERT INTO suppliers (name, tenant_id)
  VALUES ('Delete Preview Shape Test', $1)
  RETURNING id
`,
  [tenantId],
);

const testId = inserted.rows[0].id;
const preview = await client.query(
  `SELECT preview_supplier_delete($1::uuid) AS preview`,
  [testId],
);
console.log("\n0-link supplier preview raw:", preview.rows[0]?.preview);
console.log("typeof:", typeof preview.rows[0]?.preview);

await client.query(`DELETE FROM suppliers WHERE id = $1`, [testId]);
await client.end();
