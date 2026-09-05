/**
 * Apply scripts/276_finished_product_manual_stock_adjustments.sql to production and verify.
 *
 *   npx tsx scripts/apply-276-fp-manual-adj-production.ts
 *
 * Production only — refuses non-production project refs.
 * Isolated test product under Davors Enterprise only; never touches NULL (Facilities) BU.
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

    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = 'finished_product_stock_adjustments'`,
    );
    assert(
      tableCheck.rows.length === 1,
      "table finished_product_stock_adjustments missing",
    );

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
    console.log("PASS: table + record_finished_product_manual_adjustment live");

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

    const code = `FP-ADJ-TEST-PROD-${Date.now()}`;
    const ins = await client.query<{ id: string }>(
      `INSERT INTO finished_products (
         tenant_id, product_code, product_name, unit_of_measure,
         current_stock, sourcing_type, is_archived
       ) VALUES ($1, $2, $3, 'pcs', 0, 'manufactured', false)
       RETURNING id`,
      [DAVORS_TENANT, code, "FP manual adj prod verify (delete me)"],
    );
    productId = ins.rows[0]!.id;
    console.log(`Created test product ${code} (${productId})`);

    // --- opening_balance: +10 @ 5.00 (Enterprise only; never NULL) ---
    const openId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'opening_balance', 10, 5.00,
           'Production verify opening', 'open note', NULL
         ) AS id`,
        [DAVORS_TENANT, productId, ENTERPRISE_BU],
      )
    ).rows[0]!.id;

    const balOpen = await client.query(
      `SELECT current_stock, average_cost_per_unit, business_unit_id
       FROM finished_product_balances
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id = $3`,
      [DAVORS_TENANT, productId, ENTERPRISE_BU],
    );
    assert(balOpen.rows.length === 1, "expected Enterprise balance after opening");
    assert(
      balOpen.rows[0]!.business_unit_id === ENTERPRISE_BU,
      "balance must be Enterprise, not NULL",
    );
    assert(
      num(balOpen.rows[0]!.current_stock) === 10,
      `bal stock want 10 got ${balOpen.rows[0]!.current_stock}`,
    );
    assert(
      num(balOpen.rows[0]!.average_cost_per_unit) === 5,
      `bal WAC want 5 got ${balOpen.rows[0]!.average_cost_per_unit}`,
    );

    const nullBal = await client.query(
      `SELECT 1 FROM finished_product_balances
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id IS NULL`,
      [DAVORS_TENANT, productId],
    );
    assert(nullBal.rows.length === 0, "must not create Facilities/NULL balance row");

    const masterOpen = await client.query(
      `SELECT current_stock FROM finished_products WHERE id = $1`,
      [productId],
    );
    assert(num(masterOpen.rows[0]!.current_stock) === 10, "master stock want 10");

    const adjOpen = await client.query(
      `SELECT adjustment_type, quantity_delta, cost_per_unit, business_unit_id
       FROM finished_product_stock_adjustments WHERE id = $1`,
      [openId],
    );
    assert(adjOpen.rows[0]!.adjustment_type === "opening_balance", "type opening");
    assert(num(adjOpen.rows[0]!.cost_per_unit) === 5, "stored cost 5");
    assert(adjOpen.rows[0]!.business_unit_id === ENTERPRISE_BU, "adj BU Enterprise");
    console.log("PASS: opening_balance — stock 10, WAC 5; no NULL balance");

    // --- write_off: -3 (auto-capture WAC=5; WAC must stay 5) ---
    const woId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'write_off', -3, NULL,
           'Production verify write_off', NULL, NULL
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
    assert(
      num(balWo.rows[0]!.current_stock) === 7,
      `bal stock want 7 got ${balWo.rows[0]!.current_stock}`,
    );
    assert(
      num(balWo.rows[0]!.average_cost_per_unit) === 5,
      `bal WAC want 5 after write_off got ${balWo.rows[0]!.average_cost_per_unit}`,
    );
    assert(
      num(
        (
          await client.query(
            `SELECT current_stock FROM finished_products WHERE id = $1`,
            [productId],
          )
        ).rows[0]!.current_stock,
      ) === 7,
      "master 7",
    );

    const adjWo = await client.query(
      `SELECT quantity_delta, cost_per_unit FROM finished_product_stock_adjustments WHERE id = $1`,
      [woId],
    );
    assert(num(adjWo.rows[0]!.quantity_delta) === -3, "wo qty -3");
    assert(num(adjWo.rows[0]!.cost_per_unit) === 5, "wo captured cost 5");
    console.log("PASS: write_off — stock 10→7, WAC stays 5");

    // --- correction: +2 (WAC stays 5) — matches staging ---
    const corrId = (
      await client.query<{ id: string }>(
        `SELECT public.record_finished_product_manual_adjustment(
           $1, $2, $3::uuid, 'correction', 2, NULL,
           'Production verify correction', NULL, NULL
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
    assert(
      num(balCorr.rows[0]!.current_stock) === 9,
      `bal stock want 9 got ${balCorr.rows[0]!.current_stock}`,
    );
    assert(
      num(balCorr.rows[0]!.average_cost_per_unit) === 5,
      `bal WAC want 5 after correction got ${balCorr.rows[0]!.average_cost_per_unit}`,
    );
    assert(
      num(
        (
          await client.query(
            `SELECT current_stock FROM finished_products WHERE id = $1`,
            [productId],
          )
        ).rows[0]!.current_stock,
      ) === 9,
      "master 9",
    );

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

    // Cost guard
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

    console.log("\nALL PRODUCTION VERIFICATIONS PASSED");
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
        console.log(
          `Cleanup: deleted test product ${productId} + balances + adjustments`,
        );
      } catch (cleanupErr) {
        console.error(
          "CLEANUP FAILED — remove test product manually:",
          productId,
          cleanupErr,
        );
      }
    }
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
