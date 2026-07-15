import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getCurrentUserClientId,
  getCurrentUserEmployeeId,
  getCurrentUserRole,
} from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { getDashboardVisibility } from "@/utils/rbac-access";
import { buildClientDashboardSummary } from "./client-dashboard-utils";
import ClientDashboard from "./client-dashboard";
import { buildEmployeeDashboardSummary } from "./employee-dashboard-utils";
import EmployeeDashboard from "./employee-dashboard";
import { buildOperationsDashboardSummary } from "./operations-dashboard-utils";
import OperationsDashboard from "./operations-dashboard";
import Dashboard from "./dashboard";
import { buildDashboardViewModel } from "./dashboard-utils";import type { CapitalContributionEntry } from "./finance/capital-contributions-utils";
import { mergePayrollWagesSources } from "./finance/accrued-wages-utils";
import { countLowStockRawMaterials } from "./reports/inventory-reports-utils";
import { fetchInventoryBalanceSheetInput } from "./finance/balance-sheet-page-data";

export default async function DashboardPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (role === "client") {
    const clientId = await getCurrentUserClientId();

    if (!clientId) {
      return (
        <ClientDashboard
          summary={{
            clientName: "Client",
            outstandingBalance: 0,
            invoiceCount: 0,
            siteCount: 0,
            inspectionsThisMonth: 0,
            passedInspectionsThisMonth: 0,
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
          }}
          fetchError="Your user account is not linked to a client record."
        />
      );
    }

    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { summary, fetchError } = await buildClientDashboardSummary(
      supabase,
      clientId,
    );

    if (!summary) {
      return (
        <ClientDashboard
          summary={{
            clientName: "Client",
            outstandingBalance: 0,
            invoiceCount: 0,
            siteCount: 0,
            inspectionsThisMonth: 0,
            passedInspectionsThisMonth: 0,
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
          }}
          fetchError={fetchError}
        />
      );
    }

    return <ClientDashboard summary={summary} fetchError={fetchError} />;
  }

  if (role === "employee") {
    const employeeId = await getCurrentUserEmployeeId();
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    if (!employeeId) {
      return (
        <EmployeeDashboard
          summary={{
            employeeName: "Employee",
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            attendanceRecorded: 0,
            presentDays: 0,
            leaveBalances: [],
            pendingLeaveRequests: 0,
            latestPayslipMonth: null,
          }}
          fetchError="Your user account is not linked to an employee record."
        />
      );
    }

    const { summary, fetchError } = await buildEmployeeDashboardSummary(
      supabase,
      employeeId,
    );

    if (!summary) {
      return (
        <EmployeeDashboard
          summary={{
            employeeName: "Employee",
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            attendanceRecorded: 0,
            presentDays: 0,
            leaveBalances: [],
            pendingLeaveRequests: 0,
            latestPayslipMonth: null,
          }}
          fetchError={fetchError}
        />
      );
    }

    return <EmployeeDashboard summary={summary} fetchError={fetchError} />;
  }

  if (role === "supervisor" || role === "operations_manager") {
    const summaryClient =
      role === "supervisor" ? createAdminClient() : createClient(await cookies());
    const { summary, fetchError } =
      await buildOperationsDashboardSummary(summaryClient);

    return (
      <OperationsDashboard
        summary={summary}
        fetchError={fetchError}
        roleLabel={role === "supervisor" ? "Supervisor" : "Operations"}
      />
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: capitalContributions, error: capitalContributionsError },
    { data: manualEntries, error: manualError },
    { data: payrollHistoryRows, error: payrollHistoryError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    { data: payrollProcessingEntries, error: payrollProcessingError },
    inventoryBalanceSheetInput,
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select("date, amount, amount_received, outstanding_balance, service_category")
      .order("date", { ascending: true }),
    supabase
      .from("expense_register")
      .select("date, expense_category, sub_category, amount, payment_status, description, receipt_no")
      .order("date", { ascending: true }),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .order("asset_id", { ascending: true }),
    // One AP query covers balance-sheet totals and payroll liability panel fields.
    supabase
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, status, description",
      )
      .order("invoice_date", { ascending: true }),
    supabase
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .order("date", { ascending: true }),
    supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: true }),
    // One payroll_history query covers both net (wages) and gross (cost trend).
    supabase
      .from("payroll_history")
      .select("payroll_month, net_pay, gross_pay")
      .order("payroll_month", { ascending: true }),
    supabase.from("month_end_close").select("*").order("month", { ascending: false }),
    supabase
      .from("payroll_processing")
      .select("payroll_month, gross_pay, net_pay")
      .order("payroll_month", { ascending: true }),
    // Inventory input already loads raw_materials; derive low-stock count from it.
    fetchInventoryBalanceSheetInput(supabase),
  ]);

  const fetchError =
    incomeError?.message ??
    expenseError?.message ??
    fixedAssetsError?.message ??
    payableError?.message ??
    capitalContributionsError?.message ??
    manualError?.message ??
    payrollHistoryError?.message ??
    monthEndCloseError?.message ??
    payrollProcessingError?.message ??
    null;

  const payrollHistoryWages =
    payrollHistoryRows?.map((entry) => ({
      payroll_month: entry.payroll_month,
      net_pay: Number(entry.net_pay) || 0,
    })) ?? [];
  const payrollHistoryEntries =
    payrollHistoryRows?.map((entry) => ({
      payroll_month: entry.payroll_month,
      gross_pay: Number(entry.gross_pay) || 0,
    })) ?? [];
  const payrollPayables =
    payableEntries?.map((entry) => ({
      vendor_name: entry.vendor_name ?? "",
      status: entry.status ?? null,
      amount: Number(entry.amount) || 0,
      invoice_date: entry.invoice_date,
      description: entry.description ?? null,
    })) ?? [];
  const lowStockRawMaterialCount = countLowStockRawMaterials(
    inventoryBalanceSheetInput.rawMaterials,
  );

  const cashFlowIncomeEntries =
    incomeEntries?.map((entry) => ({
      date: entry.date,
      amount_received: entry.amount_received,
    })) ?? [];

  const cashFlowExpenseEntries =
    expenseEntries?.map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    })) ?? [];

  const dashboardData = buildDashboardViewModel({
    incomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossIncomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        service_category: entry.service_category,
        amount: entry.amount,
      })) ?? [],
    balanceSheetIncomeEntries: incomeEntries ?? [],
    expenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossExpenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        expense_category: entry.expense_category,
        sub_category: entry.sub_category,
        amount: entry.amount,
      })) ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions:
      (capitalContributions as CapitalContributionEntry[] | null) ?? [],
    cashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistoryWages: mergePayrollWagesSources(
      payrollHistoryWages,
      (payrollProcessingEntries ?? []).map((entry) => ({
        payroll_month: entry.payroll_month,
        net_pay: Number(entry.net_pay) || 0,
      })),
    ),
    monthEndCloseNetPay:
      monthEndCloseRecords?.map((record) => ({
        month: record.month,
        total_net_pay: record.total_net_pay,
      })) ?? [],
    manualEntries: manualEntries ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    payrollProcessingEntries: payrollProcessingEntries ?? [],
    payrollHistoryEntries,
    payrollPayables,
    lowStockRawMaterialCount,
    inventoryBalanceSheetInput,
  });

  return (
    <Dashboard
      data={dashboardData}
      fetchError={fetchError}
      visibility={getDashboardVisibility(role)}
    />
  );
}
