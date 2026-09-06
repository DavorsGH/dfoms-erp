/**
 * Apply scripts/285_atomic_payroll_release.sql to staging.
 *
 *   npx tsx scripts/apply-285-atomic-payroll-release-staging.ts
 *   npx tsx scripts/apply-285-atomic-payroll-release-staging.ts --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const SQL_FILE = "scripts/285_atomic_payroll_release.sql";

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
    "release_payroll_period",
    "reopen_payroll_period",
    "_payroll_restore_processing_from_history",
    "_payroll_open_period_core",
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
    if (!rows[0]?.src) {
      throw new Error(`Missing function ${fn}`);
    }
    if (fn.endsWith("_period") && !/SECURITY DEFINER/i.test(rows[0].src)) {
      throw new Error(`${fn} is not SECURITY DEFINER`);
    }
    if (
      fn === "reopen_payroll_period" &&
      !/daily_rate,\s*\n\s*days_to_pay,/s.test(rows[0].src) &&
      !/_payroll_open_period_core/i.test(rows[0].src)
    ) {
      throw new Error(`${fn} missing daily_rate/days_to_pay restore path`);
    }
    if (
      fn === "release_payroll_period" &&
      !/Only permanently locked periods can be released/i.test(rows[0].src)
    ) {
      throw new Error(`${fn} missing Fully Locked gate`);
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
    console.log(`=== STAGING ${verifyOnly ? "VERIFY" : "APPLY"} 285 atomic payroll release ===`);
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
