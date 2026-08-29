/**
 * Apply scripts/261_phase5e_key_structure_bu_uniques.sql after deployed-app guard.
 *
 * Usage:
 *   npx tsx scripts/apply-261-phase5e-key-structure-bu-uniques.ts --env staging
 *   npx tsx scripts/apply-261-phase5e-key-structure-bu-uniques.ts --env production
 *   npx tsx scripts/apply-261-phase5e-key-structure-bu-uniques.ts --env staging --skip-guard
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { guard261DeployedOnConflict } from "./guard-261-deployed-onconflict";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

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

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment: environment as "staging" | "production",
    skipGuard: argv.includes("--skip-guard"),
  };
}

async function main() {
  const { environment, skipGuard } = parseArgs(process.argv.slice(2));
  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef = environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(expectedRef)) {
    throw new Error(
      `Refusing: NEXT_PUBLIC_SUPABASE_URL does not look like ${environment} (${expectedRef})`,
    );
  }

  const guard = await guard261DeployedOnConflict({ environment, skipGuard });
  if (!guard.ok) {
    console.error("Apply 261 aborted — deployed app guard failed:\n" + guard.reason);
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve("scripts/261_phase5e_key_structure_bu_uniques.sql"),
      "utf8",
    );
    await client.query(sql);

    const { rows } = await client.query<{
      table_name: string;
      conname: string;
      def: string;
    }>(
      `
      SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND con.contype = 'u'
        AND c.relname IN (
          'tax_settings',
          'payroll_link',
          'month_end_close',
          'manual_financial_entries'
        )
      ORDER BY c.relname, con.conname
      `,
    );
    console.log("--- unique constraints after 261 ---");
    for (const row of rows) {
      console.log(`${row.table_name}.${row.conname}: ${row.def}`);
    }
    console.log("OK: 261 applied on", environment);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
