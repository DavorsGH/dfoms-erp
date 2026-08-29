import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
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
import type { AccountsPayablePaymentRow } from "../directors-loan-utils";
import type { DirectorsLoanRepaymentRow } from "../directors-loan-utils";
import {
  aggregateManualEntriesByPeriodMonth,
  type ManualFinancialEntryRecord,
} from "../manual-financial-entries-utils";
import type { ManualFinancialEntry } from "../cash-flow-utils";
import FinanceNav from "../finance-nav";
import CashFlow from "../cash-flow";

export default async function CashFlowPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  let manualEntriesQuery = supabase
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("period_month", { ascending: true });
  let monthEndCloseQuery = supabase
    .from("month_end_close")
    .select("month, total_net_pay")
    .eq("tenant_id", tenantId)
    .order("month", { ascending: true });

  if (buScope.mode === "unit") {
    manualEntriesQuery = manualEntriesQuery.eq(
      "business_unit_id",
      buScope.id,
    );
    monthEndCloseQuery = monthEndCloseQuery.eq(
      "business_unit_id",
      buScope.id,
    );
  } else if (buScope.mode === "default") {
    manualEntriesQuery = manualEntriesQuery.is("business_unit_id", null);
    monthEndCloseQuery = monthEndCloseQuery.is("business_unit_id", null);
  }

  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: manualEntries, error: manualError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: capitalContributions, error: capitalError },
    { data: payableEntries, error: payableError },
    { data: apPayments, error: apPaymentsError },
    { data: directorsLoanRepayments, error: directorsLoanRepaymentsError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    inventoryPurchases,
    livePayrollBundle,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount_received, entry_type, sale_status")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select(
        "date, sub_category, amount, payment_status, expense_category, description, receipt_no, notes",
      )
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    manualEntriesQuery,
    supabase
      .from("fixed_assets")
      .select(
        "tenant_id, original_cost, quantity, useful_life_years, purchase_date, depreciation_method, payment_method",
      )
      .eq("tenant_id", tenantId)
      .order("asset_id", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", tenantId)
      .order("date", { ascending: true }),
    supabase
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", tenantId)
      .order("invoice_date", { ascending: true }),
    supabase
      .from("accounts_payable_payments")
      .select("tenant_id, payment_date, amount, payment_source")
      .eq("tenant_id", tenantId)
      .order("payment_date", { ascending: true }),
    supabase
      .from("directors_loan_repayments")
      .select(
        "tenant_id, repayment_date, amount, applied_to_ap_component, applied_to_manual_component",
      )
      .eq("tenant_id", tenantId)
      .order("repayment_date", { ascending: true }),
    supabase
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", tenantId)
      .order("payroll_month", { ascending: true }),
    supabase
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("payroll_month", { ascending: true }),
    monthEndCloseQuery,
    fetchCashFlowInventoryPurchaseInput(supabase, tenantId),
    fetchPayrollLiveRecalcBundle(supabase, { tenantId }),
  ]);

  const rawManualEntries =
    (manualEntries as ManualFinancialEntryRecord[] | null) ?? [];
  const resolvedManualEntries: ManualFinancialEntry[] =
    buScope.mode === "all"
      ? (aggregateManualEntriesByPeriodMonth(
          rawManualEntries,
        ) as ManualFinancialEntry[])
      : (rawManualEntries as ManualFinancialEntry[]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    manualError?.message ??
    fixedAssetsError?.message ??
    capitalError?.message ??
    payableError?.message ??
    apPaymentsError?.message ??
    directorsLoanRepaymentsError?.message ??
    payrollHistoryError?.message ??
    payrollProcessingError?.message ??
    monthEndCloseError?.message ??
    livePayrollBundle.error ??
    null;

  const availableYears = buildAvailableYears(
    (incomeEntries ?? []).map((entry) => entry.date),
    (expenseEntries ?? []).map((entry) => entry.date),
    [
      ...resolvedManualEntries.map((entry) => entry.period_month),
      ...(fixedAssets ?? []).map((entry) => entry.purchase_date),
      ...(capitalContributions ?? []).map((entry) => entry.date),
      ...(payableEntries ?? []).map((entry) => entry.invoice_date),
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
        tenantId={tenantId}
        initialIncomeEntries={incomeEntries ?? []}
        initialExpenseEntries={expenseEntries ?? []}
        initialManualEntries={resolvedManualEntries}
        initialInventoryPurchases={inventoryPurchases}
        initialFixedAssets={fixedAssets ?? []}
        initialCapitalContributions={capitalContributions ?? []}
        initialPayableEntries={payableEntries ?? []}
        initialAccountsPayablePayments={
          (apPayments as AccountsPayablePaymentRow[] | null) ?? []
        }
        initialDirectorsLoanRepayments={
          (directorsLoanRepayments as DirectorsLoanRepaymentRow[] | null) ?? []
        }
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
