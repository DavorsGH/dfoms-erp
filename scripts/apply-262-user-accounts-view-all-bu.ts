/**
 * Apply scripts/262_user_accounts_view_all_business_units.sql after deployed-app guard.
 *
 * Usage:
 *   npx tsx scripts/apply-262-user-accounts-view-all-bu.ts --env staging --confirm-lock-view-all-gate
 *   npx tsx scripts/apply-262-user-accounts-view-all-bu.ts --env production --confirm-lock-view-all-gate
 *   npx tsx scripts/apply-262-user-accounts-view-all-bu.ts --env staging --skip-guard
 *
 * --confirm-lock-view-all-gate is required when the lock opaque token is not in
 * client chunks (typical). See scripts/README-guard-262.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { guard262DeployedViewAllBu } from "./guard-262-deployed-view-all-bu";

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
    confirmLockViewAllGate: argv.includes("--confirm-lock-view-all-gate"),
  };
}

async function main() {
  const { environment, skipGuard, confirmLockViewAllGate } = parseArgs(
    process.argv.slice(2),
  );
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

  const guard = await guard262DeployedViewAllBu({
    environment,
    skipGuard,
    confirmLockViewAllGate,
  });
  if (!guard.ok) {
    console.error(
      "Apply 262 aborted — deployed app guard failed:\n" + guard.reason,
    );
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
      resolve("scripts/262_user_accounts_view_all_business_units.sql"),
      "utf8",
    );
    await client.query(sql);

    const { rows } = await client.query<{
      column_name: string;
      data_type: string;
      column_default: string | null;
      is_nullable: string;
    }>(
      `
      SELECT column_name, data_type, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_accounts'
        AND column_name = 'view_all_business_units'
      `,
    );
    console.log("--- user_accounts.view_all_business_units after 262 ---");
    for (const row of rows) {
      console.log(
        `${row.column_name}: ${row.data_type} null=${row.is_nullable} default=${row.column_default}`,
      );
    }

    const { rows: backfill } = await client.query<{
      view_all_true: string;
      with_active_bu_tenant: string;
    }>(
      `
      SELECT
        (SELECT COUNT(*)::text FROM public.user_accounts WHERE view_all_business_units = true) AS view_all_true,
        (SELECT COUNT(*)::text FROM public.user_accounts ua
          WHERE ua.tenant_id IN (
            SELECT tenant_id FROM public.business_units WHERE is_active = true GROUP BY tenant_id HAVING COUNT(*) >= 1
          )
        ) AS with_active_bu_tenant
      `,
    );
    console.log("backfill snapshot:", backfill[0]);
    console.log("OK: 262 applied on", environment);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
