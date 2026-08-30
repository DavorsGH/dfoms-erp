/**
 * Apply scripts/263_p0_finance_gap_bu_columns.sql after env-ref guard.
 *
 * Usage:
 *   npx tsx scripts/apply-263-p0-finance-gap-bu-columns.ts --env staging --confirm-p0-finance-gap-columns
 *   npx tsx scripts/apply-263-p0-finance-gap-bu-columns.ts --env production --confirm-p0-finance-gap-columns
 *   npx tsx scripts/apply-263-p0-finance-gap-bu-columns.ts --env staging --skip-guard
 *
 * --confirm-p0-finance-gap-columns (or --skip-guard) is required. This migration
 * only ADDs nullable business_unit_id columns + rebuilds budgets_unique_period;
 * existing rows stay NULL (workspace default). No destructive backfill.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const TABLES = [
  "capital_contributions",
  "budgets",
  "client_receipts",
  "client_invoice_payments",
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

function parseArgs(argv: string[]) {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment: environment as "staging" | "production",
    skipGuard: argv.includes("--skip-guard"),
    confirm: argv.includes("--confirm-p0-finance-gap-columns"),
  };
}

async function main() {
  const { environment, skipGuard, confirm } = parseArgs(process.argv.slice(2));
  if (!skipGuard && !confirm) {
    throw new Error(
      "Refusing: pass --confirm-p0-finance-gap-columns or --skip-guard",
    );
  }

  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const expectedRef =
    environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(expectedRef)) {
    throw new Error(
      `Refusing: NEXT_PUBLIC_SUPABASE_URL does not look like ${environment} (${expectedRef})`,
    );
  }

  if (environment === "production" && skipGuard && !confirm) {
    throw new Error(
      "Refusing production with --skip-guard alone; also pass --confirm-p0-finance-gap-columns",
    );
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
      resolve("scripts/263_p0_finance_gap_bu_columns.sql"),
      "utf8",
    );
    await client.query(sql);

    for (const table of TABLES) {
      const { rows } = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = 'business_unit_id'
        `,
        [table],
      );
      if (rows.length !== 1) {
        throw new Error(`${table}.business_unit_id missing after 263`);
      }
      console.log(
        `OK ${table}.business_unit_id: ${rows[0].data_type} null=${rows[0].is_nullable}`,
      );
    }

    const { rows: idx } = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'budgets' AND indexname = 'budgets_unique_period'`,
    );
    if (!idx[0]?.indexdef?.includes("business_unit_id")) {
      throw new Error("budgets_unique_period missing business_unit_id");
    }
    console.log("OK budgets_unique_period includes business_unit_id");
    console.log(`Apply 263 complete on ${environment}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
