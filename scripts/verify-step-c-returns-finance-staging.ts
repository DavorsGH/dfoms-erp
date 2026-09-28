/**
 * Staging verification for Step C (returns in finance reports).
 * npx tsx scripts/verify-step-c-returns-finance-staging.ts --env-file .env.staging.local
 */
import { config } from "dotenv";
config({ path: process.argv.includes("--env-file") ? process.argv[process.argv.indexOf("--env-file") + 1] : ".env.local" });

import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildCustomerCreditsBalanceSheetOptions,
  fetchBalanceSheetPageData,
} from "../app/dashboard/finance/balance-sheet-page-data";
import { buildProfitLossReport } from "../app/dashboard/finance/profit-loss-utils";
import { isCustomerRefundCashOutflowExpense } from "../app/dashboard/finance/customer-refund-expense-utils";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const SEP_INDEX = 8;

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

function classifyFacilitiesIntegrity(
  scope: Awaited<
    ReturnType<typeof auditTenantBalanceSheetIntegrity>
  >["scopeResults"][number],
): string {
  if (scope.imbalances.length === 0) {
    return "success (0 imbalances)";
  }
  const sep = scope.imbalances.find((row) => row.monthIndex === SEP_INDEX);
  return `imbalances=${scope.imbalances.length} maxAbsDiff=${scope.maxAbsDiff} Sep diff=${sep?.diff ?? "n/a"}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env");
  }
  const admin = createClient(url, key);

  const { data: facilitiesBu } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS)
    .ilike("name", "%Davors Facilities%")
    .maybeSingle();

  const data = await fetchBalanceSheetPageData(admin, DAVORS, {
    dateRange: null,
    viewAllBusinessUnits: false,
    activeBusinessUnitId: facilitiesBu?.id ?? null,
  });

  const bsOptions = {
    tenantId: DAVORS,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: data.initialDirectorsLoanLedgerEntries,
    ...buildCustomerCreditsBalanceSheetOptions(data),
  };

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
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    bsOptions,
  );

  const customerCreditsRow = report.rows.find((r) => r.key === "customer-credits");
  const cashRow = report.rows.find((r) => r.key === "cash");
  const check = getBalanceCheckForPeriod(report, SEP_INDEX);

  const pl = buildProfitLossReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    FY,
  );
  const refundExpenses = data.initialExpenseEntries.filter((e) =>
    isCustomerRefundCashOutflowExpense(e),
  );
  const plRefundTotal = refundExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const integrity = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: DAVORS, name: "Davors" },
    FY,
    new Date("2026-09-30"),
  );
  const facilitiesIntegrity = integrity.scopeResults.find(
    (row) => row.businessUnitId === facilitiesBu?.id,
  );

  const { data: crnRows } = await admin
    .from("credit_notes")
    .select("credit_note_number, total_amount, refunded_amount, applied_amount, return_mode, status")
    .eq("tenant_id", DAVORS)
    .like("credit_note_number", "DF-CRNPS-%")
    .order("credit_note_number");

  const plExpensesSep = pl.rows
    .filter((r) => r.kind === "data" && r.key.startsWith("expenses-"))
    .reduce((s, r) => s + (r.amounts[SEP_INDEX] ?? 0), 0);

  console.log("=== Step C staging verification (Davors Facilities) ===");
  console.log("Facilities BU:", facilitiesBu?.id ?? "not found", facilitiesBu?.name ?? "");
  console.log("fetchError:", data.fetchError ?? "(none)");
  console.log("Test credit notes:", JSON.stringify(crnRows ?? [], null, 2));
  console.log("Customer credits (Sep 2026):", r2(getBalanceSheetAmountForMonth(customerCreditsRow!, SEP_INDEX)));
  console.log("Cash position (Sep 2026):", r2(getBalanceSheetAmountForMonth(cashRow!, SEP_INDEX)));
  console.log("BS balanced Sep:", check.isBalanced, "diff:", r2(check.difference));
  console.log("Refund expense rows:", refundExpenses.length, "sum:", r2(plRefundTotal));
  console.log("P&L expense subtotal (Sep, excl. depreciation):", r2(plExpensesSep));
  console.log(
    "Integrity (tenant-wide):",
    integrity.status,
    "maxAbsDiff:",
    integrity.maxAbsDiff,
    "imbalances:",
    integrity.imbalances.length,
  );
  console.log(
    "Integrity (Davors Facilities BU):",
    facilitiesIntegrity
      ? classifyFacilitiesIntegrity(facilitiesIntegrity)
      : "BU scope not found",
  );
  if (facilitiesIntegrity?.imbalances.length) {
    console.log(JSON.stringify(facilitiesIntegrity.imbalances.slice(0, 5), null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
