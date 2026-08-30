/**
 * Pre-apply guard for Phase 7a inventory balances (script 264).
 *
 * Dual-write lives in SQL/RPC bodies — no Vercel chunk crawl.
 *
 * Usage:
 *   npx tsx scripts/guard-264-phase7a-inventory-dual-write.ts --env staging --confirm-phase7a-inventory-balances
 *   npx tsx scripts/guard-264-phase7a-inventory-dual-write.ts --env production --confirm-phase7a-inventory-balances --confirm-7a-staging-invariant-passed
 *   npx tsx scripts/guard-264-phase7a-inventory-dual-write.ts --env staging --skip-guard
 *
 * Production refuses --skip-guard alone; requires confirm flags including
 * --confirm-7a-staging-invariant-passed (Mode A green on staging after apply).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

export type Guard264Args = {
  environment: "staging" | "production";
  skipGuard: boolean;
  confirmPhase7a: boolean;
  confirmStagingInvariant: boolean;
};

export type Guard264Result = { ok: boolean; reason: string };

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

function parseArgs(argv: string[]): Guard264Args {
  const envIdx = argv.indexOf("--env");
  const environment = envIdx >= 0 ? argv[envIdx + 1] : null;
  if (environment !== "staging" && environment !== "production") {
    throw new Error("--env staging|production required");
  }
  return {
    environment,
    skipGuard: argv.includes("--skip-guard"),
    confirmPhase7a: argv.includes("--confirm-phase7a-inventory-balances"),
    confirmStagingInvariant: argv.includes(
      "--confirm-7a-staging-invariant-passed",
    ),
  };
}

async function assertPreconditions(client: pg.Client): Promise<void> {
  const { rows: bu } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'business_units'
     ) AS exists`,
  );
  if (!bu[0]?.exists) {
    throw new Error("Precondition failed: business_units table missing");
  }

  const requiredRm = [
    "current_stock",
    "average_cost_per_unit",
    "reorder_level",
    "tenant_id",
  ];
  const { rows: rmCols } = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raw_materials'
      AND column_name = ANY($1::text[])
    `,
    [requiredRm],
  );
  const rmSet = new Set(rmCols.map((r) => r.column_name));
  for (const col of requiredRm) {
    if (!rmSet.has(col)) {
      throw new Error(`Precondition failed: raw_materials.${col} missing`);
    }
  }

  const requiredFp = ["current_stock", "tenant_id"];
  const { rows: fpCols } = await client.query<{ column_name: string }>(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'finished_products'
      AND column_name = ANY($1::text[])
    `,
    [requiredFp],
  );
  const fpSet = new Set(fpCols.map((r) => r.column_name));
  for (const col of requiredFp) {
    if (!fpSet.has(col)) {
      throw new Error(`Precondition failed: finished_products.${col} missing`);
    }
  }

  const { rows: wac } = await client.query<{
    exists: boolean;
    args: string | null;
  }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'finished_product_weighted_avg_cost'
        AND p.pronargs = 1
        AND pg_get_function_identity_arguments(p.oid) ILIKE '%uuid%'
    ) AS exists,
    (
      SELECT pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'finished_product_weighted_avg_cost'
      ORDER BY p.oid
      LIMIT 1
    ) AS args
    `,
  );
  if (!wac[0]?.exists) {
    throw new Error(
      `Precondition failed: finished_product_weighted_avg_cost(uuid) missing` +
        (wac[0]?.args != null ? ` (found args: ${wac[0].args})` : ""),
    );
  }
}

/**
 * Pre-apply guard. Returns ok/reason (does not process.exit).
 * Loads env from the matching env file when NEXT_PUBLIC_SUPABASE_URL unset.
 */
export async function runGuard264(args: Guard264Args): Promise<Guard264Result> {
  if (!args.confirmPhase7a && !args.skipGuard) {
    return {
      ok: false,
      reason:
        "Refusing: pass --confirm-phase7a-inventory-balances or --skip-guard",
    };
  }

  if (
    args.environment === "production" &&
    args.skipGuard &&
    !args.confirmPhase7a
  ) {
    return {
      ok: false,
      reason:
        "Refusing production with --skip-guard alone; also pass --confirm-phase7a-inventory-balances and --confirm-7a-staging-invariant-passed",
    };
  }

  if (args.environment === "production" && !args.confirmStagingInvariant) {
    return {
      ok: false,
      reason:
        "Refusing production: pass --confirm-7a-staging-invariant-passed (Mode A verify green on staging after apply)",
    };
  }

  if (args.skipGuard && args.environment === "staging") {
    console.log("guard-264: --skip-guard on staging — skipping DB prechecks");
    return { ok: true, reason: "skipped" };
  }

  // Even with skip-guard on production we already required confirm flags above;
  // still run env-ref + preconditions unless staging skip.
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

  if (args.skipGuard) {
    console.log(
      "guard-264: confirm flags present with --skip-guard — skipping DB prechecks",
    );
    return { ok: true, reason: "skipped" };
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
    console.log("guard-264: preconditions OK");
    return { ok: true, reason: "pass" };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile =
    args.environment === "production"
      ? ".env.local.backup"
      : ".env.staging.local";
  loadEnvForce(resolve(envFile));

  const result = await runGuard264(args);
  if (!result.ok) {
    console.error("guard-264 FAIL:", result.reason);
    process.exit(1);
  }
  console.log("guard-264 PASS:", result.reason);
}

const isMain =
  typeof process.argv[1] === "string" &&
  /guard-264-phase7a-inventory-dual-write\.(ts|js|mjs|cjs)$/.test(
    process.argv[1].replace(/\\/g, "/"),
  );

if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
