/**
 * Apply scripts/275_raw_material_manual_stock_adjustments.sql to production and verify.
 *
 *   npx tsx scripts/apply-275-rm-manual-adj-production.ts
 *
 * Production only — refuses non-production project refs.
 * Isolated test material under Davors Enterprise only; never touches NULL (Facilities) BU.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";
const ENTERPRISE_BU = "3b787f50-de08-40d5-af9c-14523a63503c";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function num(v: unknown): number {
  return Number(v) || 0;
}

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.local"],
  });
  console.log(`Connected via ${envFile} (production ${PRODUCTION_REF})`);

  let materialId: string | null = null;

  try {
    const sqlPath = resolve(
      process.cwd(),
      "scripts/275_raw_material_manual_stock_adjustments.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    console.log("Applying 275_raw_material_manual_stock_adjustments.sql …");
    await client.query(sql);
    console.log("SQL applied.");

    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'raw_material_stock_adjustments'`,
    );
    assert(tableCheck.rows.length === 1, "table raw_material_stock_adjustments missing");

    const fnCheck = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'record_raw_material_manual_adjustment'`,
    );
    assert(fnCheck.rows.length === 1, "function missing after apply");
    assert(
      fnCheck.rows[0]!.def.includes("dfoms-rm-manual-stock-adj"),
      "marker missing in function body",
    );
    assert(
      fnCheck.rows[0]!.def.includes("apply_raw_material_balance_purchase"),
      "opening path should call apply_raw_material_balance_purchase",
    );
    console.log("PASS: table + function live with expected markers");

    const buCheck = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM business_units
       WHERE tenant_id = $1 AND id = $2`,
      [DAVORS_TENANT, ENTERPRISE_BU],
    );
    assert(
      buCheck.rows.length === 1,
      "Davors Enterprise BU 3b787f50-… must already exist on production",
    );
    assert(buCheck.rows[0]!.id === ENTERPRISE_BU, "Enterprise BU id mismatch");
    console.log(`Using BU: ${buCheck.rows[0]!.name} (${ENTERPRISE_BU})`);

    // Isolated test material only (cleanup in finally)
    const materialCode = `ADJ-TEST-PROD-${Date.now()}`;
    const insMat = await client.query<{ id: string }>(
      `INSERT INTO raw_materials (
         tenant_id, material_code, material_name, unit_of_measure,
         current_stock, average_cost_per_unit, reorder_level, is_archived
       ) VALUES ($1, $2, $3, 'kg', 0, 0, NULL, false)
       RETURNING id`,
      [DAVORS_TENANT, materialCode, "Manual adj prod verify (delete me)"],
    );
    materialId = insMat.rows[0]!.id;
    console.log(`Created test material ${materialCode} (${materialId})`);

    const masterBefore = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [materialId],
    );
    assert(num(masterBefore.rows[0]!.current_stock) === 0, "master stock should start 0");
    assert(num(masterBefore.rows[0]!.average_cost_per_unit) === 0, "master avg should start 0");

    // --- opening_balance: +10 @ 5.00 (Enterprise BU only; never NULL) ---
    const openId = (
      await client.query<{ id: string }>(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3::uuid, 'opening_balance', 10, 5.00,
           'Production verify opening', 'open note', NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balAfterOpen = await client.query(
      `SELECT current_stock, average_cost_per_unit, business_unit_id
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2
         AND business_unit_id = $3`,
      [DAVORS_TENANT, materialId, ENTERPRISE_BU],
    );
    assert(balAfterOpen.rows.length === 1, "expected Enterprise balance row after opening");
    assert(balAfterOpen.rows[0]!.business_unit_id === ENTERPRISE_BU, "balance must be Enterprise, not NULL");
    assert(num(balAfterOpen.rows[0]!.current_stock) === 10, `bal stock want 10 got ${balAfterOpen.rows[0]!.current_stock}`);
    assert(num(balAfterOpen.rows[0]!.average_cost_per_unit) === 5, `bal avg want 5 got ${balAfterOpen.rows[0]!.average_cost_per_unit}`);

    const nullBal = await client.query(
      `SELECT 1 FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2 AND business_unit_id IS NULL`,
      [DAVORS_TENANT, materialId],
    );
    assert(nullBal.rows.length === 0, "must not create Facilities/NULL balance row");

    const masterAfterOpen = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [materialId],
    );
    assert(num(masterAfterOpen.rows[0]!.current_stock) === 10, "master stock want 10");
    assert(num(masterAfterOpen.rows[0]!.average_cost_per_unit) === 5, "master avg want 5");

    const adjOpen = await client.query(
      `SELECT adjustment_type, quantity_delta, cost_per_unit, reason, business_unit_id
       FROM raw_material_stock_adjustments WHERE id = $1`,
      [openId],
    );
    assert(adjOpen.rows[0]!.adjustment_type === "opening_balance", "adj type opening");
    assert(num(adjOpen.rows[0]!.quantity_delta) === 10, "adj qty 10");
    assert(num(adjOpen.rows[0]!.cost_per_unit) === 5, "adj cost 5");
    assert(adjOpen.rows[0]!.business_unit_id === ENTERPRISE_BU, "adj BU Enterprise");
    console.log("PASS: opening_balance — bal+master WAC @ 10×5.00, adjustment row stored");

    // --- write_off: -3 (qty only; WAC stays 5) ---
    const writeOffId = (
      await client.query<{ id: string }>(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', -3, NULL,
           'Production verify write_off', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balAfterWo = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, materialId, ENTERPRISE_BU],
    );
    assert(num(balAfterWo.rows[0]!.current_stock) === 7, `bal stock want 7 got ${balAfterWo.rows[0]!.current_stock}`);
    assert(num(balAfterWo.rows[0]!.average_cost_per_unit) === 5, "bal avg unchanged at 5");

    const masterAfterWo = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [materialId],
    );
    assert(num(masterAfterWo.rows[0]!.current_stock) === 7, "master stock want 7");
    assert(num(masterAfterWo.rows[0]!.average_cost_per_unit) === 5, "master avg unchanged at 5");

    const adjWo = await client.query(
      `SELECT adjustment_type, quantity_delta FROM raw_material_stock_adjustments WHERE id = $1`,
      [writeOffId],
    );
    assert(adjWo.rows[0]!.adjustment_type === "write_off", "adj type write_off");
    assert(num(adjWo.rows[0]!.quantity_delta) === -3, "adj qty -3");
    console.log("PASS: write_off — qty 10→7, WAC stays 5 on bal+master");

    // --- correction: -2 (qty only) ---
    const corrId = (
      await client.query<{ id: string }>(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3::uuid, 'correction', -2, NULL,
           'Production verify correction', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balAfterCorr = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, materialId, ENTERPRISE_BU],
    );
    assert(num(balAfterCorr.rows[0]!.current_stock) === 5, `bal stock want 5 got ${balAfterCorr.rows[0]!.current_stock}`);
    assert(num(balAfterCorr.rows[0]!.average_cost_per_unit) === 5, "bal avg still 5");

    const masterAfterCorr = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [materialId],
    );
    assert(num(masterAfterCorr.rows[0]!.current_stock) === 5, "master stock want 5");
    assert(num(masterAfterCorr.rows[0]!.average_cost_per_unit) === 5, "master avg still 5");

    const adjCorr = await client.query(
      `SELECT adjustment_type, quantity_delta FROM raw_material_stock_adjustments WHERE id = $1`,
      [corrId],
    );
    assert(adjCorr.rows[0]!.adjustment_type === "correction", "adj type correction");
    assert(num(adjCorr.rows[0]!.quantity_delta) === -2, "adj qty -2");
    console.log("PASS: correction — qty 7→5, WAC stays 5");

    // Sign-rule guard
    let blocked = false;
    try {
      await client.query(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', 1, NULL, 'should fail', NULL, NULL
         )`,
        [DAVORS_TENANT, materialId, ENTERPRISE_BU],
      );
    } catch (e) {
      blocked = String(e).includes("negative");
    }
    assert(blocked, "write_off with positive qty should raise");
    console.log("PASS: write_off rejects positive quantity_delta");

    console.log("\nALL PRODUCTION VERIFICATIONS PASSED");
  } finally {
    if (materialId) {
      try {
        await client.query(
          `DELETE FROM raw_material_stock_adjustments WHERE material_id = $1`,
          [materialId],
        );
        await client.query(
          `DELETE FROM raw_material_balances WHERE material_id = $1`,
          [materialId],
        );
        await client.query(`DELETE FROM raw_materials WHERE id = $1`, [materialId]);
        console.log(`Cleanup: deleted test material ${materialId} + balances + adjustments`);
      } catch (cleanupErr) {
        console.error("CLEANUP FAILED — remove test material manually:", materialId, cleanupErr);
      }
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
