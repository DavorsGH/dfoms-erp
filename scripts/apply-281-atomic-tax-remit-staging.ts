/**
 * Apply scripts/281_atomic_tax_remit.sql to staging.
 *
 *   npx tsx scripts/apply-281-atomic-tax-remit-staging.ts
 *   npx tsx scripts/apply-281-atomic-tax-remit-staging.ts --verify-only
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const SQL_FILE = "scripts/281_atomic_tax_remit.sql";

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
  for (const fn of ["remit_tax_for_period", "undo_remit_tax_for_period"]) {
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
    console.log(`OK: ${fn} present`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify-only");
  loadEnvForce(resolve(".env.staging.local"));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!supabaseUrl.includes(STAGING_REF) || !dbUrl.includes(STAGING_REF)) {
    throw new Error(`Refusing: env does not look like staging (${STAGING_REF})`);
  }

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    console.log(`=== STAGING ${verifyOnly ? "VERIFY" : "APPLY"} 281 atomic tax remit ===`);
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
