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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
console.log(`Target project ref: ${projectRef}\n`);

function rebuildUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

const sql = readFileSync(
  resolve(process.cwd(), "../../06 Database/90_authorized_signer_client_invoices.sql"),
  "utf8",
);

const verifySql = `
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'client_invoices'
    AND column_name IN ('authorized_by_name', 'authorized_by_title')
  ORDER BY column_name;
`;

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: rebuildUrl(process.env.DATABASE_URL),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

console.log("Running 90_authorized_signer_client_invoices.sql...");
await client.query(sql);
console.log("SUCCESS.\n");

console.log("=== verification ===");
const result = await client.query(verifySql);
console.table(result.rows);

await client.end();
