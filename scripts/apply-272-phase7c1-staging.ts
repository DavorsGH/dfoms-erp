/**
 * Apply scripts/272_phase7c1_balance_dual_write.sql and verify dual-write lines.
 *
 *   npx tsx scripts/apply-272-phase7c1-staging.ts --env staging
 *   npx tsx scripts/apply-272-phase7c1-staging.ts --env production
 *
 * Env files: staging → .env.staging.local ; production → .env.local.backup
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const CHECKS: Array<{
  name: string;
  mustInclude: string[];
}> = [
  {
    name: "update_product_purchase",
    mustInclude: [
      "adjust_finished_product_balance_qty",
      "v_purchase.business_unit_id",
      "v_qty_delta",
    ],
  },
  {
    name: "void_product_sale",
    mustInclude: [
      "adjust_finished_product_balance_qty",
      "v_sale.business_unit_id",
      "v_sale.sale_quantity",
    ],
  },
  {
    name: "delete_production_batch",
    mustInclude: [
      "adjust_finished_product_balance_qty",
      "recalculate_raw_material_inventory_scoped",
      "v_batch.business_unit_id",
      "-v_batch.quantity_produced",
    ],
  },
  {
    name: "resolve_offline_sale_conflict",
    mustInclude: [
      "adjust_finished_product_balance_qty",
      "v_business_unit_id",
      "v_shortfall",
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
      "scripts/272_phase7c1_balance_dual_write.sql",
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

      const lines = src.split("\n");
      const interesting = lines
        .map((line, idx) => ({ line, idx: idx + 1 }))
        .filter(
          ({ line }) =>
            line.includes("adjust_finished_product_balance_qty") ||
            line.includes("recalculate_raw_material_inventory_scoped") ||
            (check.name === "void_product_sale" &&
              line.includes("business_unit_id")) ||
            (check.name === "resolve_offline_sale_conflict" &&
              line.includes("business_unit_id") &&
              line.includes("v_business_unit_id")),
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
      `VERIFY PASS: all four functions show 7c.1 dual-write lines on ${environment}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
