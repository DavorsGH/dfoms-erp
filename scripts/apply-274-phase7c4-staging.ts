/**
 * Apply scripts/274_phase7c4_view_all_no_create_gate.sql and verify assert gates.
 *
 *   npx tsx scripts/apply-274-phase7c4-staging.ts --env staging
 *   npx tsx scripts/apply-274-phase7c4-staging.ts --env production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const NEEDLE = "assert_not_view_all_business_units";

const CHECK_NAMES = [
  // helpers
  "current_user_view_all_business_units",
  "assert_not_view_all_business_units",
  // Tier A
  "create_product_sale",
  "create_production_batch",
  "create_product_purchase",
  "apply_internal_consumption",
  "sync_offline_pos_cash_sale",
  "create_purchase_order",
  "apply_raw_material_purchase",
  // Tier B
  "create_sales_opportunity",
  "create_product_purchase_payable",
  "create_raw_material_purchase_payable",
  "create_fixed_asset_payable",
] as const;

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
      "scripts/274_phase7c4_view_all_no_create_gate.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    console.log(`Applying ${sqlPath} …`);
    await client.query(sql);
    console.log("Apply finished.\n");

    console.log(
      `=== Verification (pg_proc.prosrc contains "${NEEDLE}") — ${environment} ===`,
    );
    let failed = 0;

    for (const name of CHECK_NAMES) {
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
        [name],
      );

      if (!rows[0]) {
        console.log(`[FAIL] ${name}: function not found`);
        failed += 1;
        continue;
      }

      const src = rows[0].prosrc;
      const kind =
        name === "current_user_view_all_business_units" ||
        name === "assert_not_view_all_business_units"
          ? "helper"
          : "patched";

      let pass = false;
      let detail = "";
      if (name === "current_user_view_all_business_units") {
        pass = src.includes("view_all_business_units");
        detail = "contains: view_all_business_units (getter)";
      } else if (name === "assert_not_view_all_business_units") {
        pass =
          src.includes("current_user_view_all_business_units") &&
          src.includes("dfoms-bu-view-all-no-stamp");
        detail =
          "contains: current_user_view_all_business_units + dfoms-bu-view-all-no-stamp";
      } else {
        pass = src.includes(NEEDLE);
        detail = `contains: ${NEEDLE}`;
      }

      console.log(
        `[${pass ? "PASS" : "FAIL"}] ${kind} ${name}(${rows[0].args}) — ${detail}`,
      );
      if (!pass) failed += 1;

      if (kind === "patched" && pass) {
        const lines = src.split("\n");
        const beginIdx = lines.findIndex((l) => l.trim() === "BEGIN");
        const next = beginIdx >= 0 ? lines[beginIdx + 1]?.trim() ?? "" : "";
        const firstOk = next.includes(NEEDLE);
        console.log(
          `         first-after-BEGIN: [${firstOk ? "PASS" : "FAIL"}] ${next || "<empty>"}`,
        );
        if (!firstOk) failed += 1;
      }
    }

    console.log("");
    if (failed > 0) {
      console.log(`VERIFY FAILED: ${failed} check(s)`);
      process.exit(1);
    }
    console.log(
      `VERIFY PASS: helpers + all 11 patched functions show 7c.4 view-all create gate on ${environment}.`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
