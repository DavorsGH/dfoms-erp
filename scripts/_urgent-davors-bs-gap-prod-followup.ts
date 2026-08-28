/**
 * READ-ONLY: Davors 1260.02 line attribution + Aug 23 activity.
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const TARGET = 1260.02;
const r2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(PRODUCTION_REF)) throw new Error("not prod");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const page = await fetchBalanceSheetPageData(admin, DAVORS, { dateRange: null });
  const report = buildBalanceSheetReport(
    page.initialIncomeEntries,
    page.initialExpenseEntries,
    page.initialFixedAssets,
    page.initialPayableEntries,
    page.initialCapitalContributions,
    page.initialCashFlowExpenseEntries,
    page.initialPayrollHistory,
    page.initialMonthEndCloseNetPay,
    FY,
    page.initialInventoryBalanceSheet,
    page.initialManualEntries,
    page.initialTaxLedgerEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: page.initialAccountsPayablePayments,
      directorsLoanRepayments: page.initialDirectorsLoanRepayments,
    },
  );

  for (const idx of [0, 6, 7]) {
    const check = getBalanceCheckForPeriod(report, idx);
    console.log(
      `\n=== Month idx ${idx}: diff=${r2(check.difference)} assets=${r2(check.totalAssets)} LE=${r2(check.totalLiabilitiesAndEquity)} ===`,
    );
    for (const row of report.rows) {
      if (row.kind === "section" || row.kind === "spacer") continue;
      const amt = r2(getBalanceSheetAmountForMonth(row, idx));
      if (Math.abs(amt) < 0.005) continue;
      console.log(`  ${row.kind.padEnd(10)} ${row.label}: ${amt.toFixed(2)}`);
    }
  }

  console.log("\n=== Exact ±1260.02 matches (any month 0-11) ===");
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    for (let i = 0; i < 12; i += 1) {
      const amt = r2(getBalanceSheetAmountForMonth(row, i));
      if (Math.abs(Math.abs(amt) - TARGET) < 0.02) {
        console.log(`M${i + 1} ${row.kind} ${row.label} = ${amt}`);
      }
    }
  }

  console.log("\n=== Inventory config / stocks ===");
  const inv = page.initialInventoryBalanceSheet;
  console.log(JSON.stringify(inv?.config, null, 2));
  console.log(
    "rawMaterials",
    JSON.stringify(
      (inv?.rawMaterials ?? []).map((m) => ({
        id: m.id,
        name: m.material_name,
        stock: m.current_stock,
        unit_cost: (m as { unit_cost?: number | null }).unit_cost ?? null,
      })),
      null,
      2,
    ),
  );
  console.log(
    "finishedProducts",
    JSON.stringify(
      (inv?.finishedProducts ?? []).map((p) => ({
        id: p.id,
        name: p.product_name,
        stock: p.current_stock,
      })),
      null,
      2,
    ),
  );
  console.log("avgCosts", JSON.stringify(inv?.finishedProductAverageCosts, null, 2));
  console.log("cashPurchases count", inv?.cashPurchases?.length);
  console.log("productCashPurchases count", inv?.productCashPurchases?.length);

  // Aug 23 activity
  console.log("\n=== Activity dated 2026-08-23 ===");
  const { data: income } = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, description, amount, amount_received, outstanding_balance, entry_type, payment_status, sale_status, is_system_adjustment, product_id, sale_quantity, unit_price, cogs_expense_id",
    )
    .eq("tenant_id", DAVORS)
    .eq("date", "2026-08-23");
  console.log("income", JSON.stringify(income, null, 2));

  const { data: expense } = await admin
    .from("expense_register")
    .select(
      "id, date, receipt_no, description, amount, expense_category, sub_category, payment_status, vendor, price, quantity, payment_method",
    )
    .eq("tenant_id", DAVORS)
    .eq("date", "2026-08-23");
  console.log("expense", JSON.stringify(expense, null, 2));

  const { data: rmPurchases } = await admin
    .from("raw_material_purchases")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("purchase_date", "2026-08-23");
  console.log("raw_material_purchases", JSON.stringify(rmPurchases, null, 2));

  const { data: prodPurchases } = await admin
    .from("product_purchases")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("purchase_date", "2026-08-23");
  console.log("product_purchases", JSON.stringify(prodPurchases, null, 2));

  const { data: sm } = await admin
    .from("stock_movements")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("movement_date", "2026-08-23");
  console.log("stock_movements", JSON.stringify(sm, null, 2));

  const { data: batches } = await admin
    .from("production_batches")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("production_date", "2026-08-23");
  console.log("production_batches", JSON.stringify(batches, null, 2));

  const { data: apPay } = await admin
    .from("accounts_payable_payments")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("payment_date", "2026-08-23");
  console.log("ap_payments", JSON.stringify(apPay, null, 2));

  const { data: ap } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("invoice_date", "2026-08-23");
  console.log("ap invoices", JSON.stringify(ap, null, 2));

  const { data: fa } = await admin
    .from("fixed_assets")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("purchase_date", "2026-08-23");
  console.log("fixed_assets", JSON.stringify(fa, null, 2));

  // Manual financial entries are period_month based
  const { data: manuals } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", DAVORS);
  console.log("manual_financial_entries all:", JSON.stringify(manuals, null, 2));

  // System adjustments
  const { data: sys } = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, description, amount, is_system_adjustment, payment_status, outstanding_balance",
    )
    .eq("tenant_id", DAVORS)
    .eq("is_system_adjustment", true);
  console.log("system_adjustment income:", JSON.stringify(sys, null, 2));

  // COGS expenses linked to Aug 23 sales
  const cogsIds = (income ?? [])
    .map((r) => r.cogs_expense_id)
    .filter(Boolean);
  if (cogsIds.length) {
    const { data: cogs } = await admin
      .from("expense_register")
      .select("id, date, receipt_no, amount, expense_category, description")
      .in("id", cogsIds);
    console.log("cogs for Aug23 sales:", JSON.stringify(cogs, null, 2));
  }

  // Diff Aug vs Jul for each line — what closed the 1260 gap?
  console.log("\n=== Lines that changed Jul→Aug by ~1260 or closed gap ===");
  for (const row of report.rows) {
    if (row.kind === "section" || row.kind === "spacer") continue;
    const jul = r2(getBalanceSheetAmountForMonth(row, 6));
    const aug = r2(getBalanceSheetAmountForMonth(row, 7));
    const delta = r2(aug - jul);
    if (Math.abs(delta) < 0.005) continue;
    if (Math.abs(delta) >= 50 || Math.abs(Math.abs(delta) - TARGET) < 1) {
      console.log(
        `${row.kind} ${row.label}: Jul=${jul.toFixed(2)} Aug=${aug.toFixed(2)} delta=${delta.toFixed(2)}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
