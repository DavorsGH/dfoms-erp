/**
 * Staging: verify RM purchase cost edit cascades into production batches
 * without rewriting sold-unit COGS, and that BS stays balanced.
 *
 *   npx tsx scripts/test-240-cascade-rm-cost-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { connectPg } from "./lib/pg-connect";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  calculateInventoryValueAsOf,
  emptyInventoryValuationHistory,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

type Check = { step: string; pass: boolean; detail: string };
const checks: Check[] = [];

function record(step: string, pass: boolean, detail: string) {
  checks.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function r4(n: number) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "staging Supabase required");
  assert(key, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client: db } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  const stamp = Date.now().toString(36).toUpperCase();
  const tag = `CASC240${stamp}`;
  const ids = {
    material: crypto.randomUUID(),
    product: crypto.randomUUID(),
    purchase: crypto.randomUUID(),
    batch: null as string | null,
    sale: null as string | null,
    cogs: null as string | null,
  };

  try {
    const ua = await db.query(
      `
      SELECT auth_uid
      FROM user_accounts
      WHERE tenant_id = $1 AND COALESCE(is_active, true) = true
      LIMIT 1
      `,
      [DAVORS],
    );
    assert(ua.rows[0]?.auth_uid, "Need active Davors user_accounts row");
    const authUid = ua.rows[0].auth_uid as string;
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [
      authUid,
    ]);
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify({ sub: authUid, role: "authenticated" }),
    ]);

    async function davorsBalanceDiff() {
      const pageData = await fetchBalanceSheetPageData(admin, DAVORS, {
        dateRange: null,
      });
      const fy = new Date().getUTCFullYear();
      const report = buildBalanceSheetReport(
        pageData.initialIncomeEntries,
        pageData.initialExpenseEntries,
        pageData.initialFixedAssets,
        pageData.initialPayableEntries,
        pageData.initialCapitalContributions,
        pageData.initialCashFlowExpenseEntries,
        pageData.initialPayrollHistory,
        pageData.initialMonthEndCloseNetPay,
        fy,
        pageData.initialInventoryBalanceSheet,
        pageData.initialManualEntries,
        pageData.initialTaxLedgerEntries,
        {
          tenantId: DAVORS,
          accountsPayablePayments: pageData.initialAccountsPayablePayments,
          directorsLoanRepayments: pageData.initialDirectorsLoanRepayments,
        },
      );
      return getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
    }

    const balanceBefore = await davorsBalanceDiff();
    record(
      "captured Davors FY balance baseline before seed",
      true,
      `diff=${balanceBefore.difference} balanced=${balanceBefore.isBalanced}`,
    );

    const todayRes = await db.query(`SELECT CURRENT_DATE::text AS d`);
    const today = todayRes.rows[0].d as string;

    // Seed RM + purchase (trigger applies perpetual WAC)
    await db.query(
      `
      INSERT INTO raw_materials (
        id, tenant_id, material_code, material_name, unit_of_measure,
        current_stock, average_cost_per_unit
      ) VALUES ($1, $2, $3, $4, 'kg', 0, 0)
      `,
      [ids.material, DAVORS, `${tag}-RM`, `${tag} Cascade RM`],
    );
    await db.query(
      `
      INSERT INTO raw_material_purchases (
        id, tenant_id, material_id, purchase_date, quantity, cost_per_unit,
        total_cost, supplier, payment_method, notes
      ) VALUES ($1, $2, $3, $4::date, 100, 10, 1000, $5, 'Cash', $6)
      `,
      [ids.purchase, DAVORS, ids.material, today, `${tag} Supplier`, `${tag} purchase`],
    );

    const rmAfterBuy = await db.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [ids.material],
    );
    record(
      "purchase seed: RM stock/WAC",
      Number(rmAfterBuy.rows[0].current_stock) === 100 &&
        Number(rmAfterBuy.rows[0].average_cost_per_unit) === 10,
      `stock=${rmAfterBuy.rows[0].current_stock} avg=${rmAfterBuy.rows[0].average_cost_per_unit}`,
    );

    await db.query(
      `
      INSERT INTO finished_products (
        id, tenant_id, product_code, product_name, unit_of_measure,
        current_stock, standard_selling_price, sourcing_type
      ) VALUES ($1, $2, $3, $4, 'unit', 0, 50, 'manufactured')
      `,
      [ids.product, DAVORS, `${tag}-FP`, `${tag} Cascade FP`],
    );

    const batchRes = await db.query(
      `
      SELECT create_production_batch(
        $1, $2::date, $3::uuid, 10::numeric, $4,
        $5::jsonb, NULL::date, NULL::date
      ) AS id
      `,
      [
        `${tag}-B1`,
        today,
        ids.product,
        `${tag} batch`,
        JSON.stringify([{ material_id: ids.material, quantity_used: 50 }]),
      ],
    );
    ids.batch = batchRes.rows[0].id as string;

    const batchBefore = await db.query(
      `
      SELECT total_batch_cost, cost_per_unit_produced
      FROM production_batches WHERE id = $1
      `,
      [ids.batch],
    );
    const pbmBefore = await db.query(
      `
      SELECT cost_at_time FROM production_batch_materials
      WHERE batch_id = $1 AND material_id = $2
      `,
      [ids.batch, ids.material],
    );
    record(
      "batch seed: cost locked at production WAC",
      Number(batchBefore.rows[0].total_batch_cost) === 500 &&
        Number(batchBefore.rows[0].cost_per_unit_produced) === 50 &&
        Number(pbmBefore.rows[0].cost_at_time) === 10,
      `batch=${batchBefore.rows[0].total_batch_cost} unit=${batchBefore.rows[0].cost_per_unit_produced} cost_at_time=${pbmBefore.rows[0].cost_at_time}`,
    );

    const customer = await db.query(
      `
      SELECT client_id, client_name
      FROM customers
      WHERE tenant_id = $1
      LIMIT 1
      `,
      [DAVORS],
    );
    const clientId = (customer.rows[0]?.client_id as string | undefined) ?? null;
    const customerName =
      (customer.rows[0]?.client_name as string | undefined)?.trim() || "Walk-in";

    const saleRes = await db.query(
      `
      SELECT create_product_sale(
        $1::date, $2, $3, $4, $5::uuid,
        4::numeric, 50::numeric, 200::numeric,
        'Paid', $1::date, $6, NULL
      ) AS id
      `,
      [today, `${tag}-INV`, clientId, customerName, ids.product, `${tag} partial sale`],
    );
    ids.sale = saleRes.rows[0].id as string;

    const saleRow = await db.query(
      `
      SELECT cogs_expense_id, sale_quantity
      FROM income_register WHERE id = $1
      `,
      [ids.sale],
    );
    ids.cogs = saleRow.rows[0].cogs_expense_id as string;
    assert(ids.cogs, "sale missing cogs_expense_id");

    const cogsBefore = await db.query(
      `SELECT price, quantity, amount FROM expense_register WHERE id = $1`,
      [ids.cogs],
    );
    record(
      "partial sale COGS snapshotted at pre-edit unit cost",
      Number(cogsBefore.rows[0].price) === 50 &&
        Number(cogsBefore.rows[0].amount) === 200,
      `price=${cogsBefore.rows[0].price} amount=${cogsBefore.rows[0].amount}`,
    );

    const fpBefore = await db.query(
      `SELECT current_stock FROM finished_products WHERE id = $1`,
      [ids.product],
    );
    record(
      "partial sale left 6 units on hand",
      Number(fpBefore.rows[0].current_stock) === 6,
      `stock=${fpBefore.rows[0].current_stock}`,
    );

    const wacBefore = await db.query(
      `SELECT finished_product_weighted_avg_cost($1::uuid) AS wac`,
      [ids.product],
    );
    record(
      "pre-edit live FP WAC = 50",
      Number(wacBefore.rows[0].wac) === 50,
      `wac=${wacBefore.rows[0].wac}`,
    );

    const cogsSnapshot = {
      price: Number(cogsBefore.rows[0].price),
      quantity: Number(cogsBefore.rows[0].quantity),
      amount: Number(cogsBefore.rows[0].amount),
    };

    // Edit purchase cost 10 → 20 (cascade inside update_raw_material_purchase)
    await db.query(
      `
      SELECT update_raw_material_purchase(
        $1::uuid, $2::date, 100::numeric, 20::numeric, $3, 'Cash', $4
      )
      `,
      [ids.purchase, today, `${tag} Supplier`, `${tag} purchase corrected`],
    );

    const rmAfter = await db.query(
      `SELECT current_stock, average_cost_per_unit FROM raw_materials WHERE id = $1`,
      [ids.material],
    );
    record(
      "RM WAC recalculated to lifetime 20 after purchase edit",
      Number(rmAfter.rows[0].average_cost_per_unit) === 20 &&
        Number(rmAfter.rows[0].current_stock) === 50,
      `stock=${rmAfter.rows[0].current_stock} avg=${rmAfter.rows[0].average_cost_per_unit}`,
    );

    const pbmAfter = await db.query(
      `
      SELECT cost_at_time FROM production_batch_materials
      WHERE batch_id = $1 AND material_id = $2
      `,
      [ids.batch, ids.material],
    );
    record(
      "production_batch_materials.cost_at_time cascaded to 20",
      Number(pbmAfter.rows[0].cost_at_time) === 20,
      `cost_at_time=${pbmAfter.rows[0].cost_at_time}`,
    );

    const batchAfter = await db.query(
      `
      SELECT total_batch_cost, cost_per_unit_produced
      FROM production_batches WHERE id = $1
      `,
      [ids.batch],
    );
    record(
      "production_batches totals rebuilt from cascaded material cost",
      Number(batchAfter.rows[0].total_batch_cost) === 1000 &&
        Number(batchAfter.rows[0].cost_per_unit_produced) === 100,
      `total=${batchAfter.rows[0].total_batch_cost} unit=${batchAfter.rows[0].cost_per_unit_produced}`,
    );

    const wacAfter = await db.query(
      `SELECT finished_product_weighted_avg_cost($1::uuid) AS wac`,
      [ids.product],
    );
    const expectedWac = r4(800 / 6);
    record(
      "live FP WAC (145) reflects cascade; sold COGS not restated in WAC formula",
      Number(wacAfter.rows[0].wac) === expectedWac,
      `wac=${wacAfter.rows[0].wac} expected=${expectedWac}`,
    );

    const cogsAfter = await db.query(
      `SELECT price, quantity, amount FROM expense_register WHERE id = $1`,
      [ids.cogs],
    );
    record(
      "sold-unit COGS expense_register completely unchanged",
      Number(cogsAfter.rows[0].price) === cogsSnapshot.price &&
        Number(cogsAfter.rows[0].quantity) === cogsSnapshot.quantity &&
        Number(cogsAfter.rows[0].amount) === cogsSnapshot.amount,
      `before=${JSON.stringify(cogsSnapshot)} after=${JSON.stringify(cogsAfter.rows[0])}`,
    );

    // Confirm no accidental COGS mutation for this product beyond the original row
    const cogsCount = await db.query(
      `
      SELECT COUNT(*)::int AS n
      FROM income_register i
      JOIN expense_register e
        ON e.id = i.cogs_expense_id OR e.id = i.cogs_reversal_expense_id
      WHERE i.product_id = $1 AND i.entry_type = 'product_sale'
      `,
      [ids.product],
    );
    record(
      "only original sale COGS link exists (no rewrite/extra COGS)",
      Number(cogsCount.rows[0].n) === 1,
      `cogs_links=${cogsCount.rows[0].n}`,
    );

    const pageData = await fetchBalanceSheetPageData(admin, DAVORS, {
      dateRange: null,
    });
    const inv = pageData.initialInventoryBalanceSheet;
    const history = inv.valuationHistory ?? emptyInventoryValuationHistory();
    const ourInflow = history.finishedProductInflows.find(
      (row) => row.product_id === ids.product && Number(row.total_cost) === 1000,
    );
    const invAsOf = calculateInventoryValueAsOf(history, inv.config, today);
    record(
      "month-aware BS history sees updated batch total_cost",
      Boolean(ourInflow),
      `inflow_total=${ourInflow?.total_cost ?? "missing"} invAsOf=${invAsOf}`,
    );

    // Balance-check is asserted after cleanup (below) so seed rows don't skew FY.

    // Cleanup seed rows (must succeed for baseline delta assertion)
    if (ids.sale) {
      const sale = await db.query(
        `
        SELECT cogs_expense_id, cogs_reversal_expense_id, sale_quantity, product_id,
               sale_status
        FROM income_register WHERE id = $1
        `,
        [ids.sale],
      );
      if (sale.rows[0]) {
        if (
          sale.rows[0].sale_status !== "voided" &&
          sale.rows[0].product_id &&
          sale.rows[0].sale_quantity
        ) {
          await db.query(
            `
            UPDATE finished_products
            SET current_stock = current_stock + $2
            WHERE id = $1
            `,
            [sale.rows[0].product_id, sale.rows[0].sale_quantity],
          );
        }
        await db.query(`DELETE FROM income_register WHERE id = $1`, [ids.sale]);
        if (sale.rows[0].cogs_expense_id) {
          await db.query(`DELETE FROM expense_register WHERE id = $1`, [
            sale.rows[0].cogs_expense_id,
          ]);
        }
        if (sale.rows[0].cogs_reversal_expense_id) {
          await db.query(`DELETE FROM expense_register WHERE id = $1`, [
            sale.rows[0].cogs_reversal_expense_id,
          ]);
        }
      }
    }
    if (ids.batch) {
      try {
        await db.query(`SELECT delete_production_batch($1::uuid)`, [ids.batch]);
      } catch {
        await db.query(
          `DELETE FROM production_batch_materials WHERE batch_id = $1`,
          [ids.batch],
        );
        await db.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [
          ids.batch,
        ]);
        await db.query(`DELETE FROM production_batches WHERE id = $1`, [
          ids.batch,
        ]);
        // Restore RM consumption if batch hard-deleted
        await db.query(`SELECT recalculate_raw_material_inventory($1::uuid)`, [
          ids.material,
        ]);
      }
    }
    try {
      await db.query(`SELECT delete_raw_material_purchase($1::uuid)`, [
        ids.purchase,
      ]);
    } catch {
      await db.query(`DELETE FROM raw_material_purchases WHERE id = $1`, [
        ids.purchase,
      ]);
      await db.query(`SELECT recalculate_raw_material_inventory($1::uuid)`, [
        ids.material,
      ]);
    }
    await db.query(`DELETE FROM stock_movements WHERE product_id = $1`, [
      ids.product,
    ]);
    await db.query(`DELETE FROM finished_products WHERE id = $1`, [ids.product]);
    await db.query(`DELETE FROM raw_materials WHERE id = $1`, [ids.material]);

    const balanceAfter = await davorsBalanceDiff();
    const delta = Math.abs(balanceAfter.difference - balanceBefore.difference);
    record(
      "Davors FY imbalance unchanged vs pre-seed baseline after cascade + cleanup",
      delta <= 0.05,
      `before=${balanceBefore.difference} after=${balanceAfter.difference} delta=${delta}`,
    );
  } finally {
    await db.end();
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
