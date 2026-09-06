/**
 * Apply scripts/282_atomic_purchase_ap_fixed_asset.sql to staging.
 *
 *   npx tsx scripts/apply-282-atomic-purchase-ap-fixed-asset-staging.ts
 *   npx tsx scripts/apply-282-atomic-purchase-ap-fixed-asset-staging.ts --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const SQL_FILE = "scripts/282_atomic_purchase_ap_fixed_asset.sql";

const PUBLIC_RPCS = [
  "replace_purchase_tax_ledger_entries",
  "save_accounts_payable",
  "delete_accounts_payable",
  "save_fixed_asset",
  "delete_fixed_asset",
] as const;

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
  for (const fn of PUBLIC_RPCS) {
    const { rows } = await client.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM pg_proc WHERE proname = $1`,
      [fn],
    );
    if (Number(rows[0]?.cnt ?? 0) < 1) {
      throw new Error(`Missing function ${fn}`);
    }
    console.log(`OK: ${fn} present`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  loadEnvForce(resolve(".env.staging.local"));

  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(STAGING_REF)) {
    throw new Error(`Refusing: env does not look like staging (${STAGING_REF})`);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log(`=== STAGING ${verifyOnly ? "VERIFY" : "APPLY"} 282 atomic purchase AP/FA ===`);
    if (!verifyOnly) {
      await client.query(readFileSync(resolve(SQL_FILE), "utf8"));
      console.log("SQL applied");
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
