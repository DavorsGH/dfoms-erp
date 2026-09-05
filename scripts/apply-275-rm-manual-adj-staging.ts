/**
 * Apply scripts/275_raw_material_manual_stock_adjustments.sql to staging and verify.
 *
 *   npx tsx scripts/apply-275-rm-manual-adj-staging.ts
 *
 * Staging only — refuses production project refs.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
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
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.staging.verify.local"],
  });
  console.log(`Connected via ${envFile} (staging ${STAGING_REF})`);

  try {
    const sqlPath = resolve(
      process.cwd(),
      "scripts/275_raw_material_manual_stock_adjustments.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    console.log("Applying 275_raw_material_manual_stock_adjustments.sql …");
    await client.query(sql);
    console.log("SQL applied.");

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
    console.log("PASS: function present with expected markers");

    // Staging may not yet have Enterprise (prod-parity id). Ensure it for verification.
    let buCheck = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM business_units
       WHERE tenant_id = $1 AND id = $2`,
      [DAVORS_TENANT, ENTERPRISE_BU],
    );
    if (buCheck.rows.length === 0) {
      const byName = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM business_units
         WHERE tenant_id = $1 AND name ILIKE '%Enterprise%'
         ORDER BY name LIMIT 1`,
        [DAVORS_TENANT],
      );
      if (byName.rows.length === 1) {
        buCheck = byName;
        console.log(
          `NOTE: using existing Enterprise-named BU ${byName.rows[0]!.id} (prod id absent on staging)`,
        );
      } else {
        await client.query(
          `INSERT INTO business_units (id, tenant_id, name, is_active)
           VALUES ($1, $2, 'Davors Enterprise', true)
           ON CONFLICT (id) DO NOTHING`,
          [ENTERPRISE_BU, DAVORS_TENANT],
        );
        buCheck = await client.query(
          `SELECT id, name FROM business_units WHERE id = $1`,
          [ENTERPRISE_BU],
        );
        console.log("NOTE: seeded Davors Enterprise on staging for verification");
      }
    }
    assert(buCheck.rows.length === 1, "Davors Enterprise BU not available on staging");
    const enterpriseBuId = buCheck.rows[0]!.id as string;
    console.log(`Using BU: ${buCheck.rows[0]!.name} (${enterpriseBuId})`);

    // Isolated test material (cleanup at end)
    const materialCode = `ADJ-TEST-${Date.now()}`;
    const insMat = await client.query<{ id: string }>(
      `INSERT INTO raw_materials (
         tenant_id, material_code, material_name, unit_of_measure,
         current_stock, average_cost_per_unit, reorder_level, is_archived
       ) VALUES ($1, $2, $3, 'kg', 0, 0, NULL, false)
       RETURNING id`,
      [DAVORS_TENANT, materialCode, "Manual adj verify material"],
    );
    const materialId = insMat.rows[0]!.id;
    console.log(`Created test material ${materialCode} (${materialId})`);

    const masterBefore = await client.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [materialId],
    );
    assert(num(masterBefore.rows[0]!.current_stock) === 0, "master stock should start 0");
    assert(num(masterBefore.rows[0]!.average_cost_per_unit) === 0, "master avg should start 0");

    // --- opening_balance: +10 @ 5.00 ---
    const openId = (
      await client.query<{ id: string }>(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3, 'opening_balance', 10, 5.00,
           'Staging verify opening', 'open note', NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, enterpriseBuId],
      )
    ).rows[0]!.id;

    const balAfterOpen = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2
         AND business_unit_id IS NOT DISTINCT FROM $3`,
      [DAVORS_TENANT, materialId, enterpriseBuId],
    );
    assert(balAfterOpen.rows.length === 1, "expected Enterprise balance row after opening");
    assert(num(balAfterOpen.rows[0]!.current_stock) === 10, `bal stock want 10 got ${balAfterOpen.rows[0]!.current_stock}`);
    assert(num(balAfterOpen.rows[0]!.average_cost_per_unit) === 5, `bal avg want 5 got ${balAfterOpen.rows[0]!.average_cost_per_unit}`);

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
    assert(adjOpen.rows[0]!.business_unit_id === enterpriseBuId, "adj BU Enterprise");
    console.log("PASS: opening_balance — bal+master WAC @ 10×5.00, adjustment row stored");

    // --- write_off: -3 (qty only; WAC stays 5) ---
    const writeOffId = (
      await client.query<{ id: string }>(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3, 'write_off', -3, NULL,
           'Staging verify write_off', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, enterpriseBuId],
      )
    ).rows[0]!.id;

    const balAfterWo = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2
         AND business_unit_id IS NOT DISTINCT FROM $3`,
      [DAVORS_TENANT, materialId, enterpriseBuId],
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
           $1, $2, $3, 'correction', -2, NULL,
           'Staging verify correction', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, materialId, enterpriseBuId],
      )
    ).rows[0]!.id;

    const balAfterCorr = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM raw_material_balances
       WHERE tenant_id = $1 AND material_id = $2
         AND business_unit_id IS NOT DISTINCT FROM $3`,
      [DAVORS_TENANT, materialId, enterpriseBuId],
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

    // Sign-rule guard checks
    let blocked = false;
    try {
      await client.query(
        `SELECT public.record_raw_material_manual_adjustment(
           $1, $2, $3, 'write_off', 1, NULL, 'should fail', NULL, NULL
         )`,
        [DAVORS_TENANT, materialId, enterpriseBuId],
      );
    } catch (e) {
      blocked = String(e).includes("negative");
    }
    assert(blocked, "write_off with positive qty should raise");
    console.log("PASS: write_off rejects positive quantity_delta");

    // Cleanup
    await client.query(
      `DELETE FROM raw_material_stock_adjustments WHERE material_id = $1`,
      [materialId],
    );
    await client.query(
      `DELETE FROM raw_material_balances WHERE material_id = $1`,
      [materialId],
    );
    await client.query(`DELETE FROM raw_materials WHERE id = $1`, [materialId]);
    console.log("Cleanup: deleted test material, balances, adjustments");

    console.log("\nALL STAGING VERIFICATIONS PASSED");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
