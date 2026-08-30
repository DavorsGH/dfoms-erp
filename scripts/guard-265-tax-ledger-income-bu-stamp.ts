/**
 * Pre-apply guard for Phase 265 tax ledger income BU stamp.
 *
 * Usage:
 *   npx tsx scripts/guard-265-tax-ledger-income-bu-stamp.ts --env staging --confirm-tax-ledger-income-bu-stamp
 *   npx tsx scripts/guard-265-tax-ledger-income-bu-stamp.ts --env production --confirm-tax-ledger-income-bu-stamp --confirm-265-staging-verified
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

export type Guard265Args = {
  environment: "staging" | "production";
  skipGuard: boolean;
  confirmStamp: boolean;
  confirmStagingVerified: boolean;
};

export type Guard265Result = { ok: boolean; reason: string };

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

function parseArgs(argv: string[]): Guard265Args {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment,
    skipGuard: argv.includes("--skip-guard"),
    confirmStamp: argv.includes("--confirm-tax-ledger-income-bu-stamp"),
    confirmStagingVerified: argv.includes("--confirm-265-staging-verified"),
  };
}

async function assertPreconditions(client: pg.Client): Promise<void> {
  for (const check of [
    { table: "tax_ledger_entries", column: "business_unit_id" },
    { table: "income_register", column: "business_unit_id" },
  ] as const) {
    const { rows } = await client.query<{ exists: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
      `,
      [check.table, check.column],
    );
    if (!rows[0]?.exists) {
      throw new Error(
        `Precondition failed: ${check.table}.${check.column} missing`,
      );
    }
  }

  const { rows: fn } = await client.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'replace_income_register_tax_ledger_entries'
        AND pg_get_function_identity_arguments(p.oid) ILIKE '%text%jsonb%'
    ) AS exists
    `,
  );
  if (!fn[0]?.exists) {
    throw new Error(
      "Precondition failed: replace_income_register_tax_ledger_entries(text, jsonb) missing",
    );
  }
}

export async function runGuard265(
  args: Guard265Args,
): Promise<Guard265Result> {
  if (!args.confirmStamp && !args.skipGuard) {
    return {
      ok: false,
      reason:
        "Refusing: pass --confirm-tax-ledger-income-bu-stamp or --skip-guard",
    };
  }

  if (
    args.environment === "production" &&
    args.skipGuard &&
    !args.confirmStamp
  ) {
    return {
      ok: false,
      reason:
        "Refusing production with --skip-guard alone; also pass --confirm-tax-ledger-income-bu-stamp and --confirm-265-staging-verified",
    };
  }

  if (args.environment === "production" && !args.confirmStagingVerified) {
    return {
      ok: false,
      reason:
        "Refusing production: pass --confirm-265-staging-verified after staging apply + isolation verify",
    };
  }

  if (args.skipGuard && args.environment === "staging") {
    console.log("guard-265: --skip-guard on staging — skipping DB prechecks");
    return { ok: true, reason: "skipped" };
  }

  const envFile =
    args.environment === "production"
      ? ".env.local.backup"
      : ".env.staging.local";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.DATABASE_URL) {
    loadEnvForce(resolve(envFile));
  }

  const expectedRef =
    args.environment === "production" ? PRODUCTION_REF : STAGING_REF;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!supabaseUrl.includes(expectedRef)) {
    return {
      ok: false,
      reason: `Refusing: NEXT_PUBLIC_SUPABASE_URL does not look like ${args.environment} (${expectedRef})`,
    };
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    return { ok: false, reason: "DATABASE_URL missing" };
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await assertPreconditions(client);
  } finally {
    await client.end();
  }

  console.log("guard-265: preconditions OK");
  return { ok: true, reason: "ok" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile =
    args.environment === "production"
      ? ".env.local.backup"
      : ".env.staging.local";
  loadEnvForce(resolve(envFile));
  const result = await runGuard265(args);
  if (!result.ok) {
    console.error(result.reason);
    process.exit(1);
  }
  console.log(`guard-265 OK (${args.environment}): ${result.reason}`);
}

const invokedDirectly = process.argv[1]
  ?.replace(/\\/g, "/")
  .includes("guard-265-tax-ledger-income-bu-stamp");

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
