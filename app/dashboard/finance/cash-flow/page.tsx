import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { buildAvailableYears } from "../finance-year-utils";
import { fetchCashFlowInventoryPurchaseInput } from "../balance-sheet-page-data";
import type {
  MonthEndCloseNetPayEntry,
  PayrollHistoryWagesEntry,
} from "../accrued-wages-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../../hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../../hr-payroll/payroll-processing-utils";
import FinanceNav from "../finance-nav";
import CashFlow from "../cash-flow";

export default async function CashFlowPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: manualEntries, error: manualError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: capitalContributions, error: capitalError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    inventoryPurchases,
    livePayrollBundle,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount_received, entry_type, sale_status")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, sub_category, amount, payment_status, expense_category, description, receipt_no, notes",
      )
      .order("date", { ascending: true }),
    supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .order("date", { ascending: true }),
    // Display-only payroll net map inputs — same sources Balance Sheet uses.
    // Never written back from this report path.
    supabase
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .order("payroll_month", { ascending: true }),
    supabase
      .from("payroll_processing")
      .select("*")
      .order("payroll_month", { ascending: true }),
    supabase
      .from("month_end_close")
      .select("month, total_net_pay")
      .order("month", { ascending: true }),
    fetchCashFlowInventoryPurchaseInput(supabase, tenantId),
    fetchPayrollLiveRecalcBundle(supabase, { tenantId }),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    manualError?.message ??
    fixedAssetsError?.message ??
    capitalError?.message ??
    payrollHistoryError?.message ??
    payrollProcessingError?.message ??
    monthEndCloseError?.message ??
    livePayrollBundle.error ??
    null;

  const availableYears = buildAvailableYears(
    (incomeEntries ?? []).map((entry) => entry.date),
    (expenseEntries ?? []).map((entry) => entry.date),
    [
      ...(manualEntries ?? []).map((entry) => entry.period_month),
      ...(fixedAssets ?? []).map((entry) => entry.purchase_date),
      ...(capitalContributions ?? []).map((entry) => entry.date),
    ],
  );

  const initialPayrollHistory = mergePayrollWagesWithLiveOpenMonths(
    (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-[#0f2744]">Finance</h1>
      <FinanceNav />
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Cash Flow</h2>
      <CashFlow
        initialIncomeEntries={incomeEntries ?? []}
        initialExpenseEntries={expenseEntries ?? []}
        initialManualEntries={manualEntries ?? []}
        initialInventoryPurchases={inventoryPurchases}
        initialFixedAssets={fixedAssets ?? []}
        initialCapitalContributions={capitalContributions ?? []}
        initialPayrollHistory={initialPayrollHistory}
        initialMonthEndCloseNetPay={
          (monthEndCloseRecords as MonthEndCloseNetPayEntry[] | null) ?? []
        }
        availableYears={availableYears}
        fetchError={fetchError}
      />
    </div>
  );
}
