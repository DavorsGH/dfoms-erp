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

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const q = await client.query(`
  SELECT conname, conrelid::regclass AS child_table, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
  WHERE confrelid IN ('sites'::regclass, 'customers'::regclass, 'employees'::regclass)
  ORDER BY 2, 1
`);

console.log(JSON.stringify(q.rows, null, 2));
await client.end();
