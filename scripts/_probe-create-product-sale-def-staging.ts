/**
 * Inspect staging create_product_sale definition (read-only).
 *   npx tsx scripts/_probe-create-product-sale-def-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF)) throw new Error("Expected staging");
  const ref = new URL(url).hostname.split(".")[0];
  const pw = process.env.SUPABASE_DB_PASSWORD ?? process.env.DB_PASSWORD ?? "";
  const client = new pg.Client({
    connectionString: `postgresql://postgres.${ref}:${encodeURIComponent(pw)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_product_sale'
      ORDER BY p.oid DESC
      LIMIT 1
    `);
    const def = String(rows[0]?.def ?? "");
    console.log("HAS_CUSTOMER_REQUIRED:", def.includes("Select a contract client"));
    console.log("HAS_SALES_REP_PARAM:", def.includes("p_sales_rep_id"));
    console.log("INSERT_HAS_SALES_REP:", /INSERT INTO income_register[\s\S]*sales_rep_id/.test(def));
    const start = def.indexOf("INSERT INTO income_register");
    console.log("\n--- INSERT snippet ---\n");
    console.log(def.slice(start, start + 700));
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
