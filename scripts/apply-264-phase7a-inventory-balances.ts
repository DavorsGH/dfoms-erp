/**
 * Apply scripts/264_phase7a_inventory_balances.sql after Phase 7a guard.
 *
 * Usage:
 *   npx tsx scripts/apply-264-phase7a-inventory-balances.ts --env staging --confirm-phase7a-inventory-balances
 *   npx tsx scripts/apply-264-phase7a-inventory-balances.ts --env production --confirm-phase7a-inventory-balances --confirm-7a-staging-invariant-passed
 *   npx tsx scripts/apply-264-phase7a-inventory-balances.ts --env staging --skip-guard
 *
 * Do NOT apply to production until staging Mode A verify passes and soak is done.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { runGuard264 } from "./guard-264-phase7a-inventory-dual-write";
import { runVerify264 } from "./verify-264-inventory-balance-invariant";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const MARKER = "dfoms-inv-7a-dual-write";

const DUAL_WRITE_FUNCS = [
  {
    name: "apply_raw_material_purchase",
    // Trigger calls helper (table name may only appear in a comment).
    hints: [
      "apply_raw_material_balance_purchase",
      "raw_material_balances",
    ] as const,
  },
  {
    name: "create_product_sale",
    hints: ["adjust_finished_product_balance_qty"] as const,
  },
  {
    name: "create_product_purchase",
    hints: ["adjust_finished_product_balance_qty"] as const,
  },
  {
    name: "create_production_batch",
    hints: [
      "adjust_raw_material_balance_qty",
      "adjust_finished_product_balance_qty",
    ] as const,
  },
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
    confirmPhase7a: argv.includes("--confirm-phase7a-inventory-balances"),
    confirmStagingInvariant: argv.includes(
      "--confirm-7a-staging-invariant-passed",
    ),
  };
}

async function assertPostApply(client: pg.Client) {
  for (const table of [
    "raw_material_balances",
    "finished_product_balances",
  ] as const) {
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [table],
    );
    if (!rows[0]?.exists) throw new Error(`Post-apply: ${table} missing`);
    console.log(`OK table ${table}`);
  }

  const expectedUniques = [
    "raw_material_balances_tenant_material_bu_unique",
    "finished_product_balances_tenant_product_bu_unique",
    "inventory_balance_config_tenant_bu_unique",
  ];
  for (const conname of expectedUniques) {
    const { rows } = await client.query<{ def: string }>(
      `
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname = $1
      `,
      [conname],
    );
    if (!rows[0]?.def) {
      throw new Error(`Post-apply: constraint ${conname} missing`);
    }
    if (!rows[0].def.includes("NULLS NOT DISTINCT")) {
      throw new Error(
        `Post-apply: ${conname} missing NULLS NOT DISTINCT: ${rows[0].def}`,
      );
    }
    console.log(`OK unique ${conname}: ${rows[0].def}`);
  }

  for (const fn of DUAL_WRITE_FUNCS) {
    const { rows } = await client.query<{ src: string | null; args: string }>(
      `
      SELECT pg_get_functiondef(p.oid) AS src,
             pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = $1
      `,
      [fn.name],
    );
    if (rows.length !== 1) {
      throw new Error(
        `Post-apply: expected 1 ${fn.name} overload, found ${rows.length}` +
          ` (drop legacy non-BU signatures if present)`,
      );
    }
    const src = rows[0]?.src ?? "";
    if (!src.includes(MARKER)) {
      throw new Error(
        `Post-apply: ${fn.name} source missing marker ${MARKER}`,
      );
    }
    for (const hint of fn.hints) {
      if (!src.includes(hint)) {
        throw new Error(
          `Post-apply: ${fn.name} source missing dual-write ref ${hint}`,
        );
      }
    }
    console.log(`OK dual-write source ${fn.name}(${rows[0].args})`);
  }
}

async function main() {
  const {
    environment,
    skipGuard,
    confirmPhase7a,
    confirmStagingInvariant,
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

  const guard = await runGuard264({
    environment,
    skipGuard,
    confirmPhase7a,
    confirmStagingInvariant,
  });
  if (!guard.ok) {
    console.error("Apply 264 aborted — guard failed:\n" + guard.reason);
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
      resolve("scripts/264_phase7a_inventory_balances.sql"),
      "utf8",
    );
    await client.query(sql);
    console.log("OK: SQL 264 applied");

    await assertPostApply(client);
  } finally {
    await client.end();
  }

  console.log("--- post-apply Mode A verify ---");
  const verify = await runVerify264({ environment, mode: "A" });
  if (!verify.ok) {
    console.error("Apply 264 aborted — Mode A verify failed");
    process.exit(1);
  }

  console.log(`Apply 264 complete on ${environment}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
