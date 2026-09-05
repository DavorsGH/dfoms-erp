/**
 * Apply scripts/276_finished_product_manual_stock_adjustments.sql to staging and verify.
 *
 *   npx tsx scripts/apply-276-fp-manual-adj-staging.ts
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

  let productId: string | null = null;

  try {
    const sqlPath = resolve(
      process.cwd(),
      "scripts/276_finished_product_manual_stock_adjustments.sql",
    );
    const sql = readFileSync(sqlPath, "utf8");
    console.log("Applying 276_finished_product_manual_stock_adjustments.sql …");
    await client.query(sql);
    console.log("SQL applied.");

    const wacDef = (
      await client.query<{ def: string }>(
        `SELECT pg_get_functiondef(p.oid) AS def
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'finished_product_weighted_avg_cost_scoped'`,
      )
    ).rows[0]!.def;
    assert(
      wacDef.includes("finished_product_stock_adjustments"),
      "WAC function missing adjustments term",
    );
    assert(
      wacDef.includes("quantity_delta * fsa.cost_per_unit") ||
        wacDef.includes("fsa.quantity_delta * fsa.cost_per_unit"),
      "WAC adjustments formula missing",
    );
    console.log("PASS: WAC function includes adjustments numerator term");

    const fnCheck = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'record_finished_product_manual_adjustment'`,
    );
    assert(fnCheck.rows.length === 1, "record function missing");
    assert(
      fnCheck.rows[0]!.def.includes("dfoms-fp-manual-stock-adj"),
      "marker missing",
    );
    console.log("PASS: record_finished_product_manual_adjustment present");

    let buCheck = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM business_units
       WHERE tenant_id = $1 AND id = $2`,
      [DAVORS_TENANT, ENTERPRISE_BU],
    );
    if (buCheck.rows.length === 0) {
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
    assert(buCheck.rows.length === 1, "Enterprise BU missing");
    console.log(`Using BU: ${buCheck.rows[0]!.name} (${ENTERPRISE_BU})`);

    const code = `FP-ADJ-TEST-${Date.now()}`;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO finished_products (
         tenant_id, product_code, product_name, unit_of_measure,
         current_stock, sourcing_type, is_archived
       ) VALUES ($1, $2, $3, 'pcs', 0, 'manufactured', false)
       RETURNING id`,
      [DAVORS_TENANT, code, "FP manual adj verify product"],
    );
    productId = ins.rows[0]!.id;
    console.log(`Created test product ${code} (${productId})`);

    // --- opening_balance: +10 @ 5.00 ---
    const openId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'opening_balance', 10, 5.00,
           'Staging verify opening', 'open note', NULL
         ) AS id`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balOpen = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM finished_product_balances
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, productId, ENTERPRISE_BU],
    );
    assert(balOpen.rows.length === 1, "expected Enterprise balance after opening");
    assert(num(balOpen.rows[0]!.current_stock) === 10, `bal stock want 10 got ${balOpen.rows[0]!.current_stock}`);
    assert(num(balOpen.rows[0]!.average_cost_per_unit) === 5, `bal WAC want 5 got ${balOpen.rows[0]!.average_cost_per_unit}`);

    const masterOpen = await client.query(
      `SELECT current_stock FROM finished_products WHERE id = $1`,
      [productId],
    );
    assert(num(masterOpen.rows[0]!.current_stock) === 10, "master stock want 10");

    const adjOpen = await client.query(
      `SELECT adjustment_type, quantity_delta, cost_per_unit
       FROM finished_product_stock_adjustments WHERE id = $1`,
      [openId],
    );
    assert(adjOpen.rows[0]!.adjustment_type === "opening_balance", "type opening");
    assert(num(adjOpen.rows[0]!.cost_per_unit) === 5, "stored cost 5");
    console.log("PASS: opening_balance — stock 10, WAC 5 on bal+master qty");

    // --- write_off: -3 (auto-capture WAC=5; WAC must stay 5) ---
    const woId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', -3, NULL,
           'Staging verify write_off', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balWo = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM finished_product_balances
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, productId, ENTERPRISE_BU],
    );
    assert(num(balWo.rows[0]!.current_stock) === 7, `bal stock want 7 got ${balWo.rows[0]!.current_stock}`);
    assert(num(balWo.rows[0]!.average_cost_per_unit) === 5, `bal WAC want 5 after write_off got ${balWo.rows[0]!.average_cost_per_unit}`);
    assert(num((await client.query(`SELECT current_stock FROM finished_products WHERE id = $1`, [productId])).rows[0]!.current_stock) === 7, "master 7");

    const adjWo = await client.query(
      `SELECT quantity_delta, cost_per_unit FROM finished_product_stock_adjustments WHERE id = $1`,
      [woId],
    );
    assert(num(adjWo.rows[0]!.quantity_delta) === -3, "wo qty -3");
    assert(num(adjWo.rows[0]!.cost_per_unit) === 5, "wo captured cost 5");
    console.log("PASS: write_off — stock 10→7, WAC stays 5");

    // --- correction: +2 (WAC stays 5) ---
    const corrId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'correction', 2, NULL,
           'Staging verify correction', NULL, NULL
         ) AS id`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balCorr = await client.query(
      `SELECT current_stock, average_cost_per_unit
       FROM finished_product_balances
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, productId, ENTERPRISE_BU],
    );
    assert(num(balCorr.rows[0]!.current_stock) === 9, `bal stock want 9 got ${balCorr.rows[0]!.current_stock}`);
    assert(num(balCorr.rows[0]!.average_cost_per_unit) === 5, `bal WAC want 5 after correction got ${balCorr.rows[0]!.average_cost_per_unit}`);
    assert(num((await client.query(`SELECT current_stock FROM finished_products WHERE id = $1`, [productId])).rows[0]!.current_stock) === 9, "master 9");

    const adjCorr = await client.query(
      `SELECT quantity_delta, cost_per_unit FROM finished_product_stock_adjustments WHERE id = $1`,
      [corrId],
    );
    assert(num(adjCorr.rows[0]!.quantity_delta) === 2, "corr qty 2");
    assert(num(adjCorr.rows[0]!.cost_per_unit) === 5, "corr captured cost 5");
    console.log("PASS: correction +2 — stock 7→9, WAC stays 5");

    // Sign guard
    let blocked = false;
    try {
      await client.query(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', 1, NULL, 'should fail', NULL, NULL
         )`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      );
    } catch (e) {
      blocked = String(e).includes("negative");
    }
    assert(blocked, "write_off with positive qty should raise");
    console.log("PASS: write_off rejects positive quantity_delta");

    // Refuse caller cost on write_off
    let costBlocked = false;
    try {
      await client.query(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', -1, 9.99, 'should fail cost', NULL, NULL
         )`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      );
    } catch (e) {
      costBlocked = String(e).includes("must not supply cost_per_unit");
    }
    assert(costBlocked, "write_off with caller cost should raise");
    console.log("PASS: write_off rejects caller-supplied cost_per_unit");

    console.log("\nALL STAGING VERIFICATIONS PASSED");
  } finally {
    if (productId) {
      try {
        await client.query(
          `DELETE FROM finished_product_stock_adjustments WHERE product_id = $1`,
          [productId],
        );
        await client.query(
          `DELETE FROM finished_product_balances WHERE product_id = $1`,
          [productId],
        );
        await client.query(`DELETE FROM finished_products WHERE id = $1`, [
          productId,
        ]);
        console.log(`Cleanup: deleted test product ${productId}`);
      } catch (cleanupErr) {
        console.error("CLEANUP FAILED:", productId, cleanupErr);
      }
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
