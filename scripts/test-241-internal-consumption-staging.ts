/**
 * Staging: verify internal consumption WAC/BS fix (script 241).
 *
 *   npx tsx scripts/test-241-internal-consumption-staging.ts --env-file .env.staging.local
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
  INTERNAL_CONSUMPTION_EXPENSE_SUB_CATEGORY,
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
  const tag = `IC241${stamp}`;
  const ids = {
    material: crypto.randomUUID(),
    product: crypto.randomUUID(),
    purchase: crypto.randomUUID(),
    batch: null as string | null,
    consumption: null as string | null,
    expense: null as string | null,
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

    await db.query(
      `
      INSERT INTO raw_materials (
        id, tenant_id, material_code, material_name, unit_of_measure,
        current_stock, average_cost_per_unit
      ) VALUES ($1, $2, $3, $4, 'kg', 0, 0)
      `,
      [ids.material, DAVORS, `${tag}-RM`, `${tag} IC RM`],
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

    await db.query(
      `
      INSERT INTO finished_products (
        id, tenant_id, product_code, product_name, unit_of_measure,
        current_stock, standard_selling_price, sourcing_type
      ) VALUES ($1, $2, $3, $4, 'unit', 0, 50, 'manufactured')
      `,
      [ids.product, DAVORS, `${tag}-FP`, `${tag} IC FP`],
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

    const wacBefore = await db.query(
      `SELECT finished_product_weighted_avg_cost($1::uuid) AS wac, current_stock FROM finished_products WHERE id = $1`,
      [ids.product],
    );
    const unitWacBefore = Number(wacBefore.rows[0].wac);
    record(
      "seed batch: WAC 50 on 10 units (500 cost)",
      unitWacBefore === 50 && Number(wacBefore.rows[0].current_stock) === 10,
      `wac=${wacBefore.rows[0].wac} stock=${wacBefore.rows[0].current_stock}`,
    );

    const customer = await db.query(
      `SELECT client_id, client_name FROM customers WHERE tenant_id = $1 LIMIT 1`,
      [DAVORS],
    );
    const clientId = (customer.rows[0]?.client_id as string | undefined) ?? null;
    const customerName =
      (customer.rows[0]?.client_name as string | undefined)?.trim() || "Walk-in";

    const saleRes = await db.query(
      `
      SELECT create_product_sale(
        $1::date, $2, $3, $4, $5::uuid, 1::numeric, 75::numeric, 75::numeric,
        'Paid', $1::date, NULL, $6, 'PSI', NULL
      ) AS id
      `,
      [today, `${tag}-SALE`, clientId, customerName, ids.product, `${tag} sale`],
    );
    ids.sale = saleRes.rows[0].id as string;

    const cogsRow = await db.query(
      `
      SELECT e.id, e.price, e.quantity, e.amount
      FROM income_register i
      JOIN expense_register e ON e.id = i.cogs_expense_id
      WHERE i.id = $1
      `,
      [ids.sale],
    );
    ids.cogs = cogsRow.rows[0].id as string;
    const cogsSnapshot = {
      price: Number(cogsRow.rows[0].price),
      quantity: Number(cogsRow.rows[0].quantity),
      amount: Number(cogsRow.rows[0].amount),
    };
    record(
      "partial sale COGS at pre-sale WAC",
      cogsSnapshot.amount === 50 && cogsSnapshot.price === 50,
      JSON.stringify(cogsSnapshot),
    );

    const wacAfterSale = await db.query(
      `SELECT finished_product_weighted_avg_cost($1::uuid) AS wac, current_stock FROM finished_products WHERE id = $1`,
      [ids.product],
    );
    record(
      "WAC unchanged per-unit after sale (450/9=50)",
      Number(wacAfterSale.rows[0].wac) === 50 &&
        Number(wacAfterSale.rows[0].current_stock) === 9,
      `wac=${wacAfterSale.rows[0].wac} stock=${wacAfterSale.rows[0].current_stock}`,
    );

    const icRes = await db.query(
      `
      INSERT INTO internal_consumption (
        tenant_id, product_id, quantity, consumption_date, reason, recorded_by, notes
      ) VALUES ($1, $2, 2, $3::date, $4, 'System', $5)
      RETURNING id
      `,
      [DAVORS, ids.product, today, `${tag} internal use`, `${tag} verify IC`],
    );
    ids.consumption = icRes.rows[0].id as string;

    const icLinked = await db.query(
      `SELECT expense_register_id FROM internal_consumption WHERE id = $1`,
      [ids.consumption],
    );
    ids.expense = icLinked.rows[0]?.expense_register_id as string;
    assert(ids.expense, "internal_consumption trigger must link expense_register_id");

    const stockAfter = await db.query(
      `SELECT current_stock FROM finished_products WHERE id = $1`,
      [ids.product],
    );
    record(
      "internal consumption reduces stock",
      Number(stockAfter.rows[0].current_stock) === 7,
      `stock=${stockAfter.rows[0].current_stock}`,
    );

    const expense = await db.query(
      `
      SELECT price, quantity, amount, sub_category, payment_status, receipt_no
      FROM expense_register WHERE id = $1
      `,
      [ids.expense],
    );
    const exp = expense.rows[0];
    const wrongPostReduction = r4(2 * (450 / 7));
    record(
      "expense at PRE-reduction WAC (50, not post-reduction inflated)",
      Number(exp.price) === 50 &&
        Number(exp.quantity) === 2 &&
        Number(exp.amount) === 100 &&
        Number(exp.amount) !== wrongPostReduction,
      `amount=${exp.amount} price=${exp.price} wrong_if_post_reduction=${wrongPostReduction}`,
    );
    record(
      "expense sub-category and Non-Cash status",
      exp.sub_category === INTERNAL_CONSUMPTION_EXPENSE_SUB_CATEGORY &&
        exp.payment_status === "Non-Cash" &&
        String(exp.receipt_no).startsWith("IC-"),
      `sub=${exp.sub_category} status=${exp.payment_status} receipt=${exp.receipt_no}`,
    );

    const wacAfterIc = await db.query(
      `SELECT finished_product_weighted_avg_cost($1::uuid) AS wac FROM finished_products WHERE id = $1`,
      [ids.product],
    );
    record(
      "live WAC per-unit stable after internal consumption (350/7=50)",
      Number(wacAfterIc.rows[0].wac) === 50,
      `wac=${wacAfterIc.rows[0].wac}`,
    );

    const sm = await db.query(
      `
      SELECT movement_type FROM stock_movements
      WHERE reference_id = $1 AND movement_type = 'internal_consumption_out'
      `,
      [ids.consumption],
    );
    record(
      "stock_movements ledger row",
      sm.rows.length === 1,
      `movement_type=${sm.rows[0]?.movement_type}`,
    );

    const pageData = await fetchBalanceSheetPageData(admin, DAVORS, {
      dateRange: null,
    });
    const inv = pageData.initialInventoryBalanceSheet;
    const history = inv.valuationHistory ?? emptyInventoryValuationHistory();
    const invAsOf = calculateInventoryValueAsOf(history, inv.config, today);
    const icHistory = history.finishedProductInternalUse.filter(
      (row) => row.product_id === ids.product,
    );
    record(
      "month-aware BS includes internal-use deduction",
      icHistory.length >= 1 && icHistory.some((row) => row.amount === 100),
      `ic_rows=${icHistory.length} invAsOf=${invAsOf}`,
    );

    const cogsAfter = await db.query(
      `SELECT price, quantity, amount FROM expense_register WHERE id = $1`,
      [ids.cogs],
    );
    record(
      "product-sale COGS completely unchanged by IC fix",
      Number(cogsAfter.rows[0].price) === cogsSnapshot.price &&
        Number(cogsAfter.rows[0].quantity) === cogsSnapshot.quantity &&
        Number(cogsAfter.rows[0].amount) === cogsSnapshot.amount,
      `before=${JSON.stringify(cogsSnapshot)} after=${JSON.stringify(cogsAfter.rows[0])}`,
    );

    // Cleanup
    if (ids.consumption) {
      await db.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [
        ids.consumption,
      ]);
      await db.query(
        `UPDATE internal_consumption SET expense_register_id = NULL WHERE id = $1`,
        [ids.consumption],
      );
      if (ids.expense) {
        await db.query(`DELETE FROM expense_register WHERE id = $1`, [ids.expense]);
      }
      await db.query(`DELETE FROM internal_consumption WHERE id = $1`, [
        ids.consumption,
      ]);
    }
    if (ids.sale) {
      const sale = await db.query(
        `SELECT cogs_expense_id, cogs_reversal_expense_id, sale_quantity, product_id, sale_status FROM income_register WHERE id = $1`,
        [ids.sale],
      );
      if (sale.rows[0]?.product_id && sale.rows[0]?.sale_quantity) {
        await db.query(
          `UPDATE finished_products SET current_stock = current_stock + $2 WHERE id = $1`,
          [sale.rows[0].product_id, sale.rows[0].sale_quantity],
        );
      }
      await db.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [
        ids.sale,
      ]);
      await db.query(`DELETE FROM income_register WHERE id = $1`, [ids.sale]);
      if (sale.rows[0]?.cogs_expense_id) {
        await db.query(`DELETE FROM expense_register WHERE id = $1`, [
          sale.rows[0].cogs_expense_id,
        ]);
      }
    }
    if (ids.batch) {
      try {
        await db.query(`SELECT delete_production_batch($1::uuid)`, [ids.batch]);
      } catch {
        await db.query(`DELETE FROM production_batch_materials WHERE batch_id = $1`, [
          ids.batch,
        ]);
        await db.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [
          ids.batch,
        ]);
        await db.query(`DELETE FROM production_batches WHERE id = $1`, [ids.batch]);
        await db.query(`SELECT recalculate_raw_material_inventory($1::uuid)`, [
          ids.material,
        ]);
      }
    }
    try {
      await db.query(`SELECT delete_raw_material_purchase($1::uuid)`, [ids.purchase]);
    } catch {
      await db.query(`DELETE FROM raw_material_purchases WHERE id = $1`, [ids.purchase]);
      await db.query(`SELECT recalculate_raw_material_inventory($1::uuid)`, [
        ids.material,
      ]);
    }
    await db.query(`DELETE FROM stock_movements WHERE product_id = $1`, [ids.product]);
    await db.query(`DELETE FROM finished_products WHERE id = $1`, [ids.product]);
    await db.query(`DELETE FROM raw_materials WHERE id = $1`, [ids.material]);

    const balanceAfter = await davorsBalanceDiff();
    const delta = Math.abs(balanceAfter.difference - balanceBefore.difference);
    record(
      "Davors FY imbalance unchanged vs pre-seed baseline after IC + cleanup",
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
