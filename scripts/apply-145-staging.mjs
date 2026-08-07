/**
 * Apply script 145 (on-hand WAC) to STAGING only.
 * Usage: node scripts/apply-145-staging.mjs
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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!supabaseUrl.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error(`Refusing non-staging URL: ${supabaseUrl}`);
}

const sql = readFileSync(
  resolve(process.cwd(), "scripts/145_finished_product_on_hand_wac.sql"),
  "utf8",
);

const { default: pg } = await import("pg");
const rawUrl = process.env.DATABASE_URL;
if (!rawUrl) throw new Error("DATABASE_URL missing from .env.staging.local");

const client = new pg.Client({
  connectionString: rawUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  console.log("Applying 145_finished_product_on_hand_wac.sql to STAGING...");
  await client.query(sql);
  console.log("Done.");
} finally {
  await client.end();
}
