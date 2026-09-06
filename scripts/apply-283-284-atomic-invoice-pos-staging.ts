/**
 * Apply scripts/283_atomic_client_invoice.sql and 284_atomic_pos_checkout.sql to staging.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const SQL_FILES = [
  "scripts/283_atomic_client_invoice.sql",
  "scripts/284_atomic_pos_checkout.sql",
];

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

async function assertFunctions(client: pg.Client) {
  for (const fn of [
    "save_client_invoice",
    "change_client_invoice_status",
    "void_client_invoice",
    "checkout_pos_cart",
  ]) {
    const { rows } = await client.query<{ src: string | null }>(
      `
      SELECT pg_get_functiondef(p.oid) AS src
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1
      LIMIT 1
      `,
      [fn],
    );
    if (!rows[0]?.src) throw new Error(`Missing function ${fn}`);
    if (!/SECURITY DEFINER/i.test(rows[0].src)) {
      throw new Error(`${fn} is not SECURITY DEFINER`);
    }
    console.log(`OK: ${fn}`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  loadEnvForce(resolve(".env.staging.local"));
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(STAGING_REF)) {
    throw new Error(`Refusing: DATABASE_URL is not staging (${STAGING_REF})`);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    console.log(`=== STAGING ${verifyOnly ? "VERIFY" : "APPLY"} 283+284 ===`);
    if (!verifyOnly) {
      for (const file of SQL_FILES) {
        console.log(`Applying ${file}...`);
        await client.query(readFileSync(resolve(file), "utf8"));
      }
    }
    await assertFunctions(client);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
