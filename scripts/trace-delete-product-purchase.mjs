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

const fn = await client.query(`
  SELECT pg_get_function_arguments(p.oid) AS args,
         pg_get_function_result(p.oid) AS result_type
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.proname = 'delete_product_purchase' AND n.nspname = 'public'
`);
console.log("delete_product_purchase:", fn.rows);

await client.end();
