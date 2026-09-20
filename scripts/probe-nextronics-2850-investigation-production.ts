/**
 * Read-only deep dive: Nextronics Jun/Jul 2026 +2,850 BS gap.
 *   npx tsx scripts/probe-nextronics-2850-investigation-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  calculateInventoryByMonth,
  calculateInventoryOpeningEquityByMonth,
  calculateInventoryValueAsOf,
  calculateFinishedProductValueAsOf,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const NEXTRONICS = "da8b968e-dd42-48d5-93c5-a3147ff5de72";
const FY = 2026;

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });

  console.log("=== 1. inventory_balance_config ===");
  const cfg = await client.query(
    `SELECT * FROM inventory_balance_config WHERE tenant_id = $1`,
    [NEXTRONICS],
  );
  console.log(cfg.rows[0] ?? "NONE");

  console.log("\n=== 2. June 2026 COGS-linked sales (the 2,850 gap) ===");
  const juneCogs = await client.query(
    `
    SELECT i.id, i.invoice_no, i.date AS sale_date, i.amount AS revenue,
           i.sale_quantity, i.product_id, i.cogs_expense_id, i.sale_status,
           fp.product_code, fp.product_name, fp.current_stock,
           e.amount AS cogs_amount, e.receipt_no AS cogs_receipt, e.date AS cogs_date
    FROM income_register i
    JOIN expense_register e ON e.id = i.cogs_expense_id
    LEFT JOIN finished_products fp ON fp.id = i.product_id
    WHERE i.tenant_id = $1
      AND i.entry_type = 'product_sale'
      AND to_char(i.date::date, 'YYYY-MM') = '2026-06'
    ORDER BY i.date, i.invoice_no
    `,
    [NEXTRONICS],
  );
  let juneCogsSum = 0;
  for (const r of juneCogs.rows) {
    juneCogsSum += Number(r.cogs_amount) || 0;
    console.log(r);
  }
  console.log({ june_cogs_total: r2(juneCogsSum) });

  console.log("\n=== 3. Pre-go-live purchases & production (before 2026-08-05) ===");
  const prePurchases = await client.query(
    `
    SELECT pp.id, pp.product_id, fp.product_code, fp.product_name,
           pp.purchase_date, pp.created_at, pp.quantity, pp.total_cost, pp.cost_per_unit,
           pp.payment_method, pp.remaining_quantity
    FROM product_purchases pp
    JOIN finished_products fp ON fp.id = pp.product_id
    WHERE pp.tenant_id = $1
      AND pp.purchase_date < '2026-08-05'
    ORDER BY pp.purchase_date, pp.created_at
    `,
    [NEXTRONICS],
  );
  console.log("product_purchases before go-live:", prePurchases.rowCount);
  for (const r of prePurchases.rows) console.log(r);

  const preBatches = await client.query(
    `
    SELECT pb.id, pb.batch_number, pb.production_date, pb.created_at,
           pb.finished_product_id, fp.product_code, fp.product_name,
           pb.quantity_produced, pb.total_batch_cost, pb.remaining_quantity
    FROM production_batches pb
    JOIN finished_products fp ON fp.id = pb.finished_product_id
    WHERE pb.tenant_id = $1
      AND pb.production_date < '2026-08-05'
    ORDER BY pb.production_date, pb.created_at
    `,
    [NEXTRONICS],
  );
  console.log("\nproduction_batches before go-live:", preBatches.rowCount);
  for (const r of preBatches.rows) console.log(r);

  console.log("\n=== 4. ALL purchases/production with created_at vs go-live config ===");
  const allInflows = await client.query(
    `
    SELECT 'purchase' AS kind, pp.product_id, fp.product_code, fp.product_name,
           pp.purchase_date AS event_date, pp.created_at, pp.total_cost, pp.quantity,
           pp.payment_method
    FROM product_purchases pp
    JOIN finished_products fp ON fp.id = pp.product_id
    WHERE pp.tenant_id = $1
    UNION ALL
    SELECT 'production', pb.finished_product_id, fp.product_code, fp.product_name,
           pb.production_date, pb.created_at, pb.total_batch_cost, pb.quantity_produced, NULL
    FROM production_batches pb
    JOIN finished_products fp ON fp.id = pb.finished_product_id
    WHERE pb.tenant_id = $1
    ORDER BY event_date, created_at
    `,
    [NEXTRONICS],
  );
  const goLiveCreatedAt = cfg.rows[0]?.created_at;
  console.log({ config_created_at: goLiveCreatedAt, inflow_count: allInflows.rowCount });
  for (const r of allInflows.rows) {
    const activated =
      goLiveCreatedAt &&
      new Date(r.created_at).getTime() >= new Date(goLiveCreatedAt).getTime();
    console.log({ ...r, activated_after_go_live_config: activated });
  }

  console.log("\n=== 5. June sale products — purchase/batch history ===");
  const productIds = [...new Set(juneCogs.rows.map((r) => r.product_id).filter(Boolean))];
  for (const pid of productIds) {
    const prod = await client.query(
      `SELECT product_code, product_name, current_stock FROM finished_products WHERE id = $1`,
      [pid],
    );
    const purchases = await client.query(
      `SELECT purchase_date, created_at, quantity, total_cost, remaining_quantity, payment_method
       FROM product_purchases WHERE product_id = $1 ORDER BY purchase_date`,
      [pid],
    );
    const batches = await client.query(
      `SELECT production_date, created_at, quantity_produced, total_batch_cost, remaining_quantity
       FROM production_batches WHERE finished_product_id = $1 ORDER BY production_date`,
      [pid],
    );
    const allSales = await client.query(
      `SELECT invoice_no, date, sale_quantity, amount, sale_status,
              (SELECT amount FROM expense_register WHERE id = i.cogs_expense_id) AS cogs
       FROM income_register i WHERE product_id = $1 AND entry_type = 'product_sale' ORDER BY date`,
      [pid],
    );
    console.log({
      product: prod.rows[0],
      purchases: purchases.rows,
      batches: batches.rows,
      sales: allSales.rows,
    });
  }

  console.log("\n=== 6. Raw material purchases (any date) ===");
  const rmPurch = await client.query(
    `SELECT purchase_date, created_at, quantity, total_cost, payment_method
     FROM raw_material_purchases WHERE tenant_id = $1 ORDER BY purchase_date`,
    [NEXTRONICS],
  );
  console.log({ count: rmPurch.rowCount, rows: rmPurch.rows });

  await client.end();

  loadEnv(resolve(".env.local.backup"));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  console.log("\n=== 7. BS inventory line by month (engine calculation) ===");
  const data = await fetchBalanceSheetPageData(admin, NEXTRONICS);
  const inv = data.initialInventoryBalanceSheet;
  const config = inv.config;
  const history = inv.valuationHistory;

  const invByMonth = calculateInventoryByMonth(history, config, FY);
  const openingEq = calculateInventoryOpeningEquityByMonth(config, FY);
  const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];

  for (let i = 0; i <= 8; i += 1) {
    const monthEnd = `${FY}-${String(i + 1).padStart(2, "0")}-${new Date(FY, i + 1, 0).getDate()}`;
    const asOfValue = calculateInventoryValueAsOf(history, config, monthEnd);
    console.log({
      month: monthLabels[i],
      inventory_asset_line: r2(invByMonth[i] ?? 0),
      opening_equity_line: r2(openingEq[i] ?? 0),
      history_only_as_of_month_end: r2(asOfValue),
    });
  }

  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    inv,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: NEXTRONICS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );

  console.log("\n=== 8. BS check + key rows Jun/Jul/Aug ===");
  for (const idx of [5, 6, 7]) {
    const check = getBalanceCheckForPeriod(report, idx);
    const invRow = report.rows.find((r) => r.key === "inventory");
    const openRow = report.rows.find((r) => r.key === "inventory-opening-equity");
    const reRow = report.rows.find((r) => r.key === "retained-earnings");
    const cashRow = report.rows.find((r) => r.key === "cash");
    console.log({
      month: monthLabels[idx],
      diff: r2(check.difference),
      inventory: r2(getBalanceSheetAmountForMonth(invRow!, idx)),
      inventory_opening_equity: r2(getBalanceSheetAmountForMonth(openRow!, idx)),
      retained_earnings: r2(getBalanceSheetAmountForMonth(reRow!, idx)),
      cash: r2(getBalanceSheetAmountForMonth(cashRow!, idx)),
      total_assets: r2(check.totalAssets),
      total_le: r2(check.totalLiabilitiesAndEquity),
    });
  }

  console.log("\n=== 9. June P&L COGS vs inventory asset (mechanism check) ===");
  const juneCogsExp = data.initialExpenseEntries.filter(
    (e) =>
      e.expense_category === "Cost of Goods Sold" &&
      String(e.date ?? "").slice(0, 7) === "2026-06",
  );
  const juneCogsPl = r2(juneCogsExp.reduce((s, e) => s + (Number(e.amount) || 0), 0));
  console.log({
    june_cogs_in_pl: juneCogsPl,
    june_inventory_asset: r2(invByMonth[5] ?? 0),
    june_opening_equity: r2(openingEq[5] ?? 0),
    implied_gap_from_cogs_without_asset: juneCogsPl,
    matches_bs_diff: juneCogsPl === 2850,
  });

  console.log("\n=== 10. August go-live month — opening value vs tracked inventory ===");
  const augInv = r2(invByMonth[7] ?? 0);
  const augOpening = r2(openingEq[7] ?? 0);
  const augHistoryOnly = r2(
    calculateInventoryValueAsOf(history, config, "2026-08-31"),
  );
  console.log({
    opening_inventory_value_config: config?.opening_inventory_value ?? 0,
    august_inventory_asset_total: augInv,
    august_opening_equity: augOpening,
    august_history_valuation_only: augHistoryOnly,
    august_opening_bump: r2(augInv - augHistoryOnly),
  });

  console.log("\n=== 11. Equity / capital context ===");
  const { client: pg2 } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local.backup", ".env.vercel.production.local"],
  });
  const capital = await pg2.query(
    `SELECT date, amount, contributed_by, description FROM capital_contributions WHERE tenant_id = $1`,
    [NEXTRONICS],
  );
  const manual = await pg2.query(
    `SELECT period_month, share_capital, retained_earnings_prior_years FROM manual_financial_entries WHERE tenant_id = $1 ORDER BY period_month`,
    [NEXTRONICS],
  );
  console.log({ capital: capital.rows, manual: manual.rows });
  await pg2.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
