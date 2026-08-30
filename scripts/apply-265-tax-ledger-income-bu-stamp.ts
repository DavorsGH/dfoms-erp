/**
 * Apply scripts/265_tax_ledger_income_bu_stamp.sql after guard.
 *
 * Usage:
 *   npx tsx scripts/apply-265-tax-ledger-income-bu-stamp.ts --env staging --confirm-tax-ledger-income-bu-stamp
 *   npx tsx scripts/apply-265-tax-ledger-income-bu-stamp.ts --env production --confirm-tax-ledger-income-bu-stamp --confirm-265-staging-verified
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { runGuard265 } from "./guard-265-tax-ledger-income-bu-stamp";
import { runVerify265Core } from "./verify-265-tax-ledger-bu-isolation";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const MARKER = "dfoms-265-tax-ledger-income-bu-stamp";

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
    confirmStamp: argv.includes("--confirm-tax-ledger-income-bu-stamp"),
    confirmStagingVerified: argv.includes("--confirm-265-staging-verified"),
  };
}

async function assertPostApply(client: pg.Client) {
  const { rows } = await client.query<{ src: string | null }>(
    `
    SELECT pg_get_functiondef(p.oid) AS src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'replace_income_register_tax_ledger_entries'
      AND pg_get_function_identity_arguments(p.oid) ILIKE '%text%jsonb%'
    `,
  );
  if (rows.length !== 1) {
    throw new Error(
      `Post-apply: expected 1 replace_income_register_tax_ledger_entries overload, found ${rows.length}`,
    );
  }
  const src = rows[0]?.src ?? "";
  if (!src.includes(MARKER)) {
    throw new Error(`Post-apply: RPC missing marker ${MARKER}`);
  }
  if (!src.includes("business_unit_id")) {
    throw new Error("Post-apply: RPC missing business_unit_id");
  }
  if (!/FROM\s+public\.income_register/i.test(src)) {
    throw new Error("Post-apply: RPC does not SELECT BU from income_register");
  }
  console.log("OK RPC replace_income_register_tax_ledger_entries stamps BU");

  const { rows: orphans } = await client.query<{ n: string }>(
    `
    SELECT COUNT(*)::text AS n
    FROM public.tax_ledger_entries t
    JOIN public.income_register i
      ON t.source_type = 'income_register'
     AND t.source_id = i.id::text
    WHERE t.business_unit_id IS NULL
      AND i.business_unit_id IS NOT NULL
    `,
  );
  if (Number(orphans[0]?.n ?? -1) !== 0) {
    throw new Error(
      `Post-apply: income tax ledger orphans remain: ${orphans[0]?.n}`,
    );
  }
  console.log("OK income tax ledger orphan count = 0");
}

async function main() {
  const {
    environment,
    skipGuard,
    confirmStamp,
    confirmStagingVerified,
  } = parseArgs(process.argv.slice(2));

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

  const guard = await runGuard265({
    environment,
    skipGuard,
    confirmStamp,
    confirmStagingVerified,
  });
  if (!guard.ok) {
    console.error("Apply 265 aborted — guard failed:\n" + guard.reason);
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
      resolve("scripts/265_tax_ledger_income_bu_stamp.sql"),
      "utf8",
    );
    await client.query(sql);
    console.log("OK: SQL 265 applied");
    await assertPostApply(client);
  } finally {
    await client.end();
  }

  console.log("--- post-apply core verify ---");
  const verify = await runVerify265Core({ environment });
  if (!verify.ok) {
    console.error("Apply 265 aborted — core verify failed");
    for (const f of verify.failures) console.error(" - " + f);
    process.exit(1);
  }

  console.log(`Apply 265 complete on ${environment}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
