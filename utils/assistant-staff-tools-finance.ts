import "server-only";

import {
  calculateDaysOutstanding,
  getRemainingPayableBalance,
  normalizeAccountsPayableEntry,
} from "@/app/dashboard/finance/accounts-payable-utils";
import {
  buildTopExpenseAnalysis,
} from "@/app/dashboard/dashboard-spending-analysis-utils";
import {
  AGING_BUCKET_LABELS,
  buildFixedAssetDepreciationSchedule,
  buildStatutoryLiabilitiesReport,
  getAgingBucket,
  getDefaultReportMonthYear,
} from "@/app/dashboard/reports/finance-reports-utils";
import {
  fetchFixedAssetScheduleReportData,
  fetchStatutoryLiabilitiesReportData,
  fetchBudgetVsActualReportData,
} from "@/app/dashboard/reports/finance-report-data";
import {
  ALL_PROJECTS_FILTER,
  buildBudgetVsActualReport,
  budgetHealthStatusLabel,
  formatBudgetVsActualViewPeriodLabel,
  sumBudgetVsActualTotals,
} from "@/app/dashboard/reports/budget-vs-actual-utils";
import { monthIndexFromMonthNumber } from "@/app/dashboard/reports/finance-reports-utils";
import {
  CLIENT_INVOICE_LIST_SELECT,
  normalizeClientInvoiceListRow,
  type ClientInvoiceListRow,
} from "@/utils/client-invoices-types";
import { canAccessFinanceSection } from "@/utils/rbac-access";
import {
  SERVICE_CONTRACT_LIST_SELECT,
  normalizeServiceContractListRow,
} from "@/utils/service-contracts-types";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  loadStaffDashboardViewModel,
  parseFinancialPeriod,
  periodKeyForSelection,
  pickMonthSnapshot,
  requireStaffSession,
  resolveFinancialPeriodSelection,
} from "@/utils/assistant-staff-tool-common";
import { getCurrentCalendarMonth } from "@/app/dashboard/dashboard-utils";

function invoiceOutstanding(row: ClientInvoiceListRow): number {
  return Math.max(
    (Number(row.total_amount_due) || 0) - (Number(row.amount_received) || 0),
    0,
  );
}

function isUnpaidClientInvoice(row: ClientInvoiceListRow): boolean {
  if (row.status === "paid" || row.status === "draft") {
    return false;
  }
  return invoiceOutstanding(row) > 0;
}

export async function getOutstandingInvoices(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to invoice data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const referenceDate = new Date();
    const { data, error } = await supabase
      .from("client_invoices")
      .select(CLIENT_INVOICE_LIST_SELECT)
      .in("status", ["sent", "partial"])
      .order("due_date", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[assistant] get_outstanding_invoices failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const rows = ((data as ClientInvoiceListRow[] | null) ?? [])
      .map(normalizeClientInvoiceListRow)
      .filter(isUnpaidClientInvoice)
      .map((row) => {
        const outstanding = invoiceOutstanding(row);
        const dueDate = row.due_date ?? row.invoice_date;
        const daysOverdue = Math.max(
          calculateDaysOutstanding(dueDate, referenceDate),
          0,
        );
        const client = Array.isArray(row.client) ? row.client[0] : row.client;
        return {
          invoiceNumber: row.invoice_number,
          customerName: row.bill_to_name || client?.client_name || "Customer",
          dueDate,
          outstandingGhs: outstanding,
          daysOverdue,
          agingBucket: getAgingBucket(
            calculateDaysOutstanding(dueDate, referenceDate),
          ),
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, LIST_LIMIT);

    const totalOutstanding = rows.reduce(
      (sum, row) => sum + row.outstandingGhs,
      0,
    );

    return {
      totalOutstandingGhs: Math.round(totalOutstanding * 100) / 100,
      invoiceCount: rows.length,
      invoices: rows,
      agingBucketLabels: AGING_BUCKET_LABELS,
    };
  } catch (error) {
    console.error("[assistant] get_outstanding_invoices threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getOutstandingPayables(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to payables data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const referenceDate = new Date();
    const { data, error } = await supabase
      .from("accounts_payable")
      .select("*")
      .order("due_date", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[assistant] get_outstanding_payables failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const rows = (data ?? [])
      .map((row) => normalizeAccountsPayableEntry(row))
      .map((row) => ({
        row,
        balance: getRemainingPayableBalance(row),
      }))
      .filter((entry) => entry.balance > 0)
      .map(({ row, balance }) => ({
        vendorName: row.vendor_name,
        invoiceNumber: row.invoice_number,
        dueDate: row.due_date,
        balanceDueGhs: balance,
        daysOverdue: Math.max(
          calculateDaysOutstanding(row.due_date, referenceDate),
          0,
        ),
        status: row.status,
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .slice(0, LIST_LIMIT);

    const totalOutstanding = rows.reduce(
      (sum, row) => sum + row.balanceDueGhs,
      0,
    );

    return {
      totalOutstandingGhs: Math.round(totalOutstanding * 100) / 100,
      payableCount: rows.length,
      payables: rows,
    };
  } catch (error) {
    console.error("[assistant] get_outstanding_payables threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getTaxLedgerStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to tax ledger data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchStatutoryLiabilitiesReportData(supabase);
    const report = buildStatutoryLiabilitiesReport(
      data.initialTaxLedgerEntries,
      data.initialDueDates,
    );

    if (data.fetchError) {
      return {
        fetchWarning: data.fetchError,
        groupTotals: report.groupTotals,
        grandTotalGhs: report.grandTotal,
        liabilities: report.rows.slice(0, LIST_LIMIT),
      };
    }

    return {
      currency: "GHS" as const,
      groupTotals: report.groupTotals,
      grandTotalGhs: report.grandTotal,
      liabilities: report.rows.slice(0, LIST_LIMIT),
    };
  } catch (error) {
    console.error("[assistant] get_tax_ledger_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getExpenseBreakdown(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to expense breakdown data." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const period = parseFinancialPeriod(toolInput);
  const { mode, key } = periodKeyForSelection(period);
  const categories = buildTopExpenseAnalysis(
    dashboardResult.viewModel.spendingAnalysisExpenses,
    mode,
    key,
    "category",
  ).slice(0, LIST_LIMIT);

  return {
    period,
    periodLabel: key,
    categories,
    fetchWarning: dashboardResult.fetchError,
  };
}

export async function getFixedAssetsSummary(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to fixed asset data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const { year, month } = getDefaultReportMonthYear();
    const data = await fetchFixedAssetScheduleReportData(supabase);
    const schedule = buildFixedAssetDepreciationSchedule(
      data.initialFixedAssets,
      year,
      month,
    );

    return {
      asOfPeriodLabel: `${year}-${String(month).padStart(2, "0")}`,
      assetCount: schedule.rows.length,
      totalOriginalCostGhs: schedule.totalOriginalCost,
      totalAccumulatedDepreciationGhs: schedule.totalAccumulatedDepreciation,
      totalNetBookValueGhs: schedule.totalNetBookValue,
      assets: schedule.rows.slice(0, LIST_LIMIT).map((row) => ({
        assetId: row.assetId,
        assetName: row.assetName,
        category: row.category,
        netBookValueGhs: row.netBookValue,
      })),
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_fixed_assets_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getServiceContractsStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to service contract data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const today = new Date().toISOString().slice(0, 10);
    const renewalHorizon = new Date();
    renewalHorizon.setDate(renewalHorizon.getDate() + 60);
    const horizonIso = renewalHorizon.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("service_contracts")
      .select(SERVICE_CONTRACT_LIST_SELECT)
      .order("next_billing_date", { ascending: true });

    if (error) {
      console.error(
        "[assistant] get_service_contracts_status failed:",
        error.message,
      );
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const contracts = ((data ?? []) as Parameters<
      typeof normalizeServiceContractListRow
    >[0][]).map(normalizeServiceContractListRow);

    const active = contracts.filter((row) => row.status === "active");
    const dueForRenewal = active.filter((row) => {
      const renewalDate = row.end_date || row.next_billing_date;
      if (!renewalDate) {
        return false;
      }
      return renewalDate >= today && renewalDate <= horizonIso;
    });

    return {
      activeCount: active.length,
      dueForRenewalCount: dueForRenewal.length,
      dueForRenewal: dueForRenewal.slice(0, LIST_LIMIT).map((row) => {
        const client = Array.isArray(row.client) ? row.client[0] : row.client;
        return {
          contractNumber: row.contract_number,
          customerName: client?.client_name ?? "Customer",
          endDate: row.end_date,
          nextBillingDate: row.next_billing_date,
          autoRenew: row.auto_renew,
        };
      }),
    };
  } catch (error) {
    console.error("[assistant] get_service_contracts_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getFinancialSummary(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to financial summary data." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const period = parseFinancialPeriod(toolInput);
  const { monthKey, useYtd, periodLabel } = resolveFinancialPeriodSelection(
    period,
    dashboardResult.viewModel.defaultMonthKey,
  );
  const snapshot = pickMonthSnapshot(dashboardResult.viewModel, monthKey);
  if (!snapshot) {
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }

  const { summary } = snapshot;
  return {
    period,
    periodLabel: useYtd ? summary.ytdThroughLabel : summary.periodLabel,
    reportingWindow: periodLabel,
    currency: "GHS" as const,
    revenue: useYtd ? summary.totalRevenueYtd : summary.totalRevenue,
    expenses: useYtd ? summary.totalExpensesYtd : summary.totalExpenses,
    netProfit: useYtd ? summary.netProfitYtd : summary.netProfit,
    fetchWarning: dashboardResult.fetchError,
  };
}

export async function getBalanceSheetStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to balance sheet status." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const snapshot =
    dashboardResult.viewModel.monthSnapshots[
      dashboardResult.viewModel.defaultMonthKey
    ];
  if (!snapshot) {
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }

  const { summary } = snapshot;
  const { isBalanced, difference } = summary.balanceCheck;
  const { formatGHS } = await import(
    "@/app/dashboard/finance/income-register-utils"
  );

  return {
    asOfPeriodLabel: summary.periodLabel,
    currency: "GHS" as const,
    isBalanced,
    differenceGhs: difference,
    statusLabel: isBalanced
      ? "Balanced"
      : `Out of balance by ${formatGHS(Math.abs(difference))}`,
    fetchWarning: dashboardResult.fetchError,
  };
}

function parseBudgetStatusParams(toolInput: unknown): {
  year: number;
  month: number;
  projectId: string | null;
} {
  const { year: currentYear, month: currentMonth } = getCurrentCalendarMonth();

  if (!toolInput || typeof toolInput !== "object") {
    return { year: currentYear, month: currentMonth, projectId: null };
  }

  const input = toolInput as Record<string, unknown>;
  let year = currentYear;
  let month = currentMonth;

  if (typeof input.year === "number" && Number.isFinite(input.year)) {
    year = Math.trunc(input.year);
  }

  if (typeof input.month === "number" && Number.isFinite(input.month)) {
    month = Math.min(Math.max(Math.trunc(input.month), 1), 12);
  }

  let projectId: string | null = null;
  if (typeof input.project_id === "string") {
    const trimmed = input.project_id.trim();
    if (trimmed) {
      projectId = trimmed;
    }
  }

  return { year, month, projectId };
}

export async function getBudgetStatus(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessFinanceSection(sessionResult.session.role)) {
    return { error: "You do not have access to budget status data." };
  }

  const { year, month, projectId } = parseBudgetStatusParams(toolInput);
  const monthIndex = monthIndexFromMonthNumber(month);
  const projectFilter = projectId ?? ALL_PROJECTS_FILTER;

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchBudgetVsActualReportData(supabase);
    const report = buildBudgetVsActualReport({
      viewMode: "monthly-prorated",
      budgets: data.initialBudgets,
      expenses: data.initialExpenses,
      rawMaterialPurchases: data.initialRawMaterialPurchases,
      productPurchases: data.initialProductPurchases,
      payrollRows: data.initialPayrollRows,
      projects: data.initialProjects,
      year,
      month,
      monthIndex,
      projectFilter,
    });
    const totals = sumBudgetVsActualTotals(report);
    const periodLabel = formatBudgetVsActualViewPeriodLabel({
      viewMode: "monthly-prorated",
      year,
      month,
    });

    const projectLabel =
      projectFilter === ALL_PROJECTS_FILTER
        ? "All projects (company-wide + per-project)"
        : (() => {
            const project = data.initialProjects.find(
              (entry) => entry.id === projectFilter,
            );
            if (!project) {
              return "Selected project";
            }

            return `${project.project_code} — ${project.project_name}`;
          })();

    const variancePercentTotal =
      totals.budgeted > 0
        ? Math.round((totals.variance / totals.budgeted) * 10000) / 100
        : null;

    return {
      viewMode: "monthly-prorated" as const,
      periodLabel,
      year,
      month,
      projectFilter:
        projectFilter === ALL_PROJECTS_FILTER ? "all" : projectFilter,
      projectLabel,
      currency: "GHS" as const,
      categories: report.map((row) => ({
        category: row.rowLabel,
        subcategory: row.subcategory,
        budgetedGhs: row.budgeted,
        actualGhs: row.actual,
        varianceGhs: row.variance,
        variancePercent: row.variancePercent,
        remainingGhs: row.remaining,
        status: budgetHealthStatusLabel(row.status),
      })),
      totals: {
        budgetedGhs: totals.budgeted,
        actualGhs: totals.actual,
        varianceGhs: totals.variance,
        variancePercent: variancePercentTotal,
        remainingGhs: totals.remaining,
      },
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_budget_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}