/**
 * Apply scripts/273_phase7c2_bu_scoped_stock_gates.sql and verify BU balance gates.
 *
 *   npx tsx scripts/apply-273-phase7c2-staging.ts --env staging
 *   npx tsx scripts/apply-273-phase7c2-staging.ts --env production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const CHECKS: Array<{
  name: string;
  mustInclude: string[];
  mustNotInclude?: string[];
}> = [
  {
    name: "create_product_sale",
    mustInclude: [
      "ensure_finished_product_balance",
      "finished_product_balances",
      "v_bu_stock",
      "Only % % of % in stock, cannot sell %",
    ],
    mustNotInclude: [
      "INTO v_current_stock, v_product_name, v_unit_of_measure, v_product_tenant_id",
    ],
  },
  {
    name: "create_production_batch",
    mustInclude: [
      "ensure_raw_material_balance",
      "raw_material_balances",
      "v_bu_material_stock",
      "Insufficient stock for material %. Available: %, required: %",
    ],
    mustNotInclude: [
      "INTO v_current_stock, v_cost_at_time, v_material_tenant_id",
    ],
  },
  {
    name: "apply_internal_consumption",
    mustInclude: [
      "ensure_finished_product_balance",
      "finished_product_balances",
      "v_bu_stock",
      "Only % % of % in stock, cannot consume %",
    ],
  },
];

function parseEnv(argv: string[]): "staging" | "production" {
  const idx = argv.indexOf("--env");
  const value = idx >= 0 ? argv[idx + 1] : "staging";
  if (value !== "staging" && value !== "production") {
    throw new Error("--env staging|production required");
  }
  return value;
}

async function main() {
  const environment = parseEnv(process.argv.slice(2));
  const envFile =
    environment === "production" ? ".env.local.backup" : ".env.staging.local";
  const projectRef =
    environment === "production" ? PRODUCTION_REF : STAGING_REF;

  const { client, envFile: usedEnv } = await connectPg({
    requiredProjectRef: projectRef,
    envFiles: [envFile],
  });
  console.log(`Connected via ${usedEnv} (${environment} ${projectRef})`);

  try {
    const sqlPath = resolve(
      process.cwd(),
      "scripts/273_phase7c2_bu_scoped_stock_gates.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    console.log(`Applying ${sqlPath} …`);
    await client.query(sql);
    console.log("Apply finished.\n");

    console.log(`=== Verification (pg_proc.prosrc) — ${environment} ===`);
    let failed = 0;

    for (const check of CHECKS) {
      const { rows } = await client.query<{
        args: string;
        prosrc: string;
      }>(
        `
        SELECT pg_get_function_identity_arguments(p.oid) AS args,
               p.prosrc
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = $1
        ORDER BY p.oid DESC
        LIMIT 1
        `,
        [check.name],
      );

      if (!rows[0]) {
        console.log(`[FAIL] ${check.name}: function not found`);
        failed += 1;
        continue;
      }

      const src = rows[0].prosrc;
      console.log(`\n--- ${check.name}(${rows[0].args}) ---`);

      for (const needle of check.mustInclude) {
        const ok = src.includes(needle);
        console.log(`  [${ok ? "PASS" : "FAIL"}] contains: ${needle}`);
        if (!ok) failed += 1;
      }
      for (const needle of check.mustNotInclude ?? []) {
        const ok = !src.includes(needle);
        console.log(`  [${ok ? "PASS" : "FAIL"}] absent: ${needle}`);
        if (!ok) failed += 1;
      }

      const lines = src.split("\n");
      const interesting = lines
        .map((line, idx) => ({ line, idx: idx + 1 }))
        .filter(
          ({ line }) =>
            line.includes("finished_product_balances") ||
            line.includes("raw_material_balances") ||
            line.includes("ensure_finished_product_balance") ||
            line.includes("ensure_raw_material_balance") ||
            line.includes("v_bu_stock") ||
            line.includes("v_bu_material_stock") ||
            line.includes("cannot sell") ||
            line.includes("cannot consume") ||
            line.includes("Insufficient stock"),
        );
      if (interesting.length) {
        console.log("  matching lines:");
        for (const { line, idx } of interesting) {
          console.log(`    L${idx}: ${line.trim()}`);
        }
      }
    }

    console.log("");
    if (failed > 0) {
      console.log(`VERIFY FAILED: ${failed} check(s)`);
      process.exit(1);
    }
    console.log(
      `VERIFY PASS: all three functions show 7c.2 BU-scoped stock gates on ${environment}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
