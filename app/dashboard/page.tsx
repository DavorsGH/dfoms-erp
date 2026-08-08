import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getCurrentUserClientId,
  getCurrentUserEmployeeId,
  getCurrentUserRole,
  getCurrentUserTenantId,
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
import { buildDashboardViewModel } from "./dashboard-utils";
import {
  toSpendingAnalysisExpenseRows,
  toSpendingAnalysisIncomeRows,
} from "./dashboard-spending-analysis-utils";
import { toSalesAnalysisRows } from "./dashboard-sales-analysis-utils";
import type { ProductSaleEntry } from "./crm/product-sales-utils";
import {
  CRM_PRODUCT_SALE_SELECT,
  CRM_WEBHOOK_SALE_SELECT,
  mergeSalesLogEntries,
  normalizeProductSaleForLog,
  normalizeWebhookSale,
} from "./crm/sales/sales-utils";
import { buildSalesRepDashboardSummary } from "./sales-rep-dashboard-utils";
import SalesRepDashboard from "./sales-rep-dashboard";
import { fetchBalanceSheetPageData } from "./finance/balance-sheet-page-data";
import { countLowStockRawMaterials } from "./reports/inventory-reports-utils";

export default async function DashboardPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;

  if (role === "client") {
    const clientId = await getCurrentUserClientId();

    if (!clientId) {
      return (
        <ClientDashboard
          summary={{
            clientName: "Customer",
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
          fetchError="Your user account is not linked to a customer record."
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
            clientName: "Customer",
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
    const tenantId = await getCurrentUserTenantId();

    if (!tenantId) {
      return (
        <OperationsDashboard
          summary={{
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            understaffedSites: 0,
            totalRosterSites: 0,
            openCorrectiveActions: 0,
            openFailedInspections: 0,
            workOrdersThisMonth: 0,
            inspectionsThisMonth: 0,
          }}
          fetchError="Your user account is not linked to a tenant record."
          roleLabel={role === "supervisor" ? "Supervisor" : "Operations"}
        />
      );
    }

    const { summary, fetchError } = await buildOperationsDashboardSummary(
      summaryClient,
      tenantId,
    );

    return (
      <OperationsDashboard
        summary={summary}
        fetchError={fetchError}
        roleLabel={role === "supervisor" ? "Supervisor" : "Operations"}
      />
    );
  }

  if (role === "sales_rep") {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { summary, fetchError } = await buildSalesRepDashboardSummary(supabase);

    if (!summary) {
      return (
        <SalesRepDashboard
          summary={{
            periodLabel: new Date().toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            }),
            todayLabel: new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
            todaysSalesTotal: 0,
            todaysSaleCount: 0,
            monthSalesTotal: 0,
            monthSaleCount: 0,
          }}
          fetchError={fetchError}
        />
      );
    }

    return <SalesRepDashboard summary={summary} fetchError={fetchError} />;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const [
    balanceSheetData,
    { data: productSaleRows, error: productSaleError },
    { data: webhookSaleRows, error: webhookSaleError },
  ] = await Promise.all([
    fetchBalanceSheetPageData(supabase, tenantId),
    supabase
      .from("income_register")
      .select(CRM_PRODUCT_SALE_SELECT)
      .eq("entry_type", "product_sale")
      .order("date", { ascending: false }),
    supabase
      .from("crm_sales")
      .select(CRM_WEBHOOK_SALE_SELECT)
      .order("sale_date", { ascending: false }),
  ]);

  const {
    initialIncomeEntries: incomeEntries,
    initialExpenseEntries: expenseEntries,
    initialFixedAssets: fixedAssets,
    initialPayableEntries: payableEntries,
    initialAccountsPayablePayments: accountsPayablePayments,
    initialDirectorsLoanRepayments: directorsLoanRepayments,
    initialCapitalContributions: capitalContributions,
    initialCashFlowExpenseEntries: cashFlowExpenseEntries,
    initialPayrollHistory: payrollHistoryWages,
    initialMonthEndCloseNetPay: monthEndCloseNetPay,
    initialMonthEndCloseRecords: monthEndCloseRecords,
    initialPayrollProcessingRows: payrollProcessingEntries,
    initialPayrollHistoryGrossEntries: payrollHistoryGrossEntries,
    initialManualEntries: manualEntries,
    initialInventoryBalanceSheet: inventoryBalanceSheetInput,
    initialTaxLedgerEntries: taxLedgerEntries,
    fetchError: balanceSheetFetchError,
  } = balanceSheetData;

  const fetchError =
    balanceSheetFetchError ??
    productSaleError?.message ??
    webhookSaleError?.message ??
    null;

  const lowStockRawMaterialCount = countLowStockRawMaterials(
    inventoryBalanceSheetInput.rawMaterials,
  );

  const salesAnalysisEntries = toSalesAnalysisRows(
    mergeSalesLogEntries(
      ((productSaleRows as ProductSaleEntry[] | null) ?? []).map((row) =>
        normalizeProductSaleForLog(row),
      ),
      ((webhookSaleRows as Parameters<typeof normalizeWebhookSale>[0][] | null) ??
        []).map((row) => normalizeWebhookSale(row)),
    ),
  );

  const balanceSheetReportOptions = {
    tenantId,
    accountsPayablePayments,
    directorsLoanRepayments,
  };

  const dashboardData = buildDashboardViewModel({
    incomeEntries:
      incomeEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    productSaleEntries:
      incomeEntries
        ?.filter((entry) => entry.entry_type === "product_sale")
        .map((entry) => ({
          date: entry.date,
          amount: entry.amount,
          sale_status: entry.sale_status,
        })) ?? [],
    profitLossIncomeEntries:
      incomeEntries?.map((entry) => {
        const row = entry as typeof entry & {
          net_of_tax_amount?: number | null;
          output_vat_amount?: number | null;
        };
        return {
          date: row.date,
          service_category: row.service_category,
          amount: row.amount,
          entry_type: row.entry_type,
          sale_status: row.sale_status,
          net_of_tax_amount: row.net_of_tax_amount,
          output_vat_amount: row.output_vat_amount,
        };
      }) ?? [],
    balanceSheetIncomeEntries: incomeEntries ?? [],
    expenseEntries:
      expenseEntries?.map((entry) => ({
        date: entry.date,
        amount: entry.amount,
      })) ?? [],
    profitLossExpenseEntries: expenseEntries ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions: capitalContributions ?? [],
    cashFlowIncomeEntries: balanceSheetData.initialCashFlowIncomeEntries,
    cashFlowExpenseEntries,
    payrollHistoryWages,
    monthEndCloseNetPay,
    manualEntries: manualEntries ?? [],
    monthEndCloseRecords: monthEndCloseRecords ?? [],
    payrollProcessingEntries:
      payrollProcessingEntries?.map((entry) => ({
        payroll_month: entry.payroll_month,
        gross_pay: Number(entry.gross_pay) || 0,
      })) ?? [],
    payrollHistoryEntries: payrollHistoryGrossEntries,
    lowStockRawMaterialCount,
    inventoryBalanceSheetInput,
    taxLedgerEntries: taxLedgerEntries ?? [],
    balanceSheetReportOptions,
  });

  return (
    <Dashboard
      data={{
        ...dashboardData,
        spendingAnalysisIncome: toSpendingAnalysisIncomeRows(
          incomeEntries ?? [],
        ),
        spendingAnalysisExpenses: toSpendingAnalysisExpenseRows(
          expenseEntries ?? [],
        ),
        salesAnalysisEntries,
      }}
      fetchError={fetchError}
      visibility={getDashboardVisibility(role)}
    />
  );
}
