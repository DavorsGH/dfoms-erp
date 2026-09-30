import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import type { DashboardViewModel } from "@/app/dashboard/dashboard-utils";
import type { DashboardBudgetStatusSnapshot } from "@/app/dashboard/dashboard-budget-status-utils";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { createClient } from "@/utils/supabase/server";
import { fetchTenantBalanceSheetIntegrityStatus } from "@/utils/tenant-balance-sheet-integrity-status";
import { isPerfProbeEnabled } from "@/utils/perf-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NON_OWNER_DASHBOARD_ROLES = new Set<AppRole>([
  "client",
  "employee",
  "supervisor",
  "operations_manager",
  "sales_rep",
]);

function isOwnerDashboardRole(role: AppRole | null): boolean {
  return role != null && !NON_OWNER_DASHBOARD_ROLES.has(role);
}

const MONTH_PARAM_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseMonthParam(raw: string | null): string | null {
  if (!raw?.trim()) {
    return null;
  }
  const trimmed = raw.trim();
  if (!MONTH_PARAM_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Deep-sort object keys for stable snapshot diffs. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Mirrors client month selection in app/dashboard/dashboard.tsx (Summary Month
 * dropdown). Default on first paint is data.defaultMonthKey; API uses ?month=YYYY-MM.
 */
function buildDisplayedSnapshotPayload(
  data: DashboardViewModel,
  selectedMonthKey: string,
  fetchError: string | null,
) {
  const isYtdMode = selectedMonthKey === "ytd";
  const selectedSnapshot =
    data.monthSnapshots[isYtdMode ? data.defaultMonthKey : selectedMonthKey] ??
    data.monthSnapshots[data.defaultMonthKey];
  const { summary, payroll } = selectedSnapshot;
  const budgetMonthKey = isYtdMode ? data.defaultMonthKey : selectedMonthKey;
  const budgetStatus: DashboardBudgetStatusSnapshot =
    data.budgetStatusByMonthKey[budgetMonthKey] ??
    data.budgetStatusByMonthKey[data.defaultMonthKey] ?? {
      month: {
        label: `Month (${summary.periodLabel})`,
        budgeted: 0,
        actual: 0,
        remaining: 0,
        status: "green",
        utilizationPercent: null,
        hasBudgetLines: false,
      },
      ytd: {
        label: `YTD (${summary.ytdThroughLabel})`,
        budgeted: 0,
        actual: 0,
        remaining: 0,
        status: "green",
        utilizationPercent: null,
        hasBudgetLines: false,
      },
    };

  return {
    fetchError,
    selection: {
      selectedMonthKey,
      defaultMonthKey: data.defaultMonthKey,
      isYtdMode,
      resolvedSnapshotMonthKey: isYtdMode
        ? data.defaultMonthKey
        : selectedMonthKey,
    },
    cards: {
      netProfit: isYtdMode ? summary.netProfitYtd : summary.netProfit,
      totalPurchases: isYtdMode
        ? summary.totalPurchasesYtd
        : summary.totalPurchases,
      rawMaterialPurchases: isYtdMode
        ? summary.rawMaterialPurchasesYtd
        : summary.rawMaterialPurchases,
      productPurchases: isYtdMode
        ? summary.productPurchasesYtd
        : summary.productPurchases,
      totalRevenue: isYtdMode ? summary.totalRevenueYtd : summary.totalRevenue,
      totalExpenses: isYtdMode
        ? summary.totalExpensesYtd
        : summary.totalExpenses,
      depreciationMonth: summary.depreciation,
      depreciationYtd: summary.depreciationYtd,
      cashPosition: summary.cashPosition,
      balanceCheckIsBalanced: summary.balanceCheck.isBalanced,
      balanceCheckDifference: summary.balanceCheck.difference,
      productSales: isYtdMode ? summary.productSalesYtd : summary.productSales,
      dueFromDirectorGhs: summary.dueFromDirectorGhs,
    },
    summary,
    payroll: {
      periodLabel: payroll.periodLabel,
      lockStatus: payroll.lockStatus,
      totalPayrollCost: isYtdMode
        ? payroll.totalPayrollCostYtd
        : payroll.totalPayrollCost,
      totalPayrollCostMonth: payroll.totalPayrollCost,
      totalPayrollCostYtd: payroll.totalPayrollCostYtd,
      pendingPayrollLiabilities: payroll.pendingPayrollLiabilities,
      liabilityReferenceLabel: payroll.liabilityReferenceLabel,
      payrollNotProcessed: payroll.payrollNotProcessed,
    },
    budgetStatus,
    lowStockRawMaterialCount: data.lowStockRawMaterialCount,
    balanceSheetIntegrity: data.balanceSheetIntegrity,
    charts: {
      profitTrend: data.profitTrend,
      cashTrend: data.cashTrend,
      payrollTrend: data.payrollTrend,
    },
    spendingAnalysisIncome: data.spendingAnalysisIncome,
    spendingAnalysisExpenses: data.spendingAnalysisExpenses,
    salesAnalysisEntries: data.salesAnalysisEntries,
    monthOptions: data.monthOptions,
  };
}

export async function GET(request: Request) {
  if (!isPerfProbeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const monthKey = parseMonthParam(
    new URL(request.url).searchParams.get("month"),
  );
  if (!monthKey) {
    return NextResponse.json(
      { error: "Query param month=YYYY-MM is required." },
      { status: 400 },
    );
  }

  const role = (await getCurrentUserRole(ROUTE_HANDLER_AUTH_OPTS)) as AppRole | null;
  if (!isOwnerDashboardRole(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [tenantId, authUid, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS),
      getCurrentAuthUid(ROUTE_HANDLER_AUTH_OPTS),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const dashboardPageData = await fetchDashboardPageData(supabase, tenantId, {
    activeBusinessUnitId,
    viewAllBusinessUnits,
  });
  const [viewModelBase, balanceSheetIntegrity] = await Promise.all([
    buildOwnerDashboardViewModel(dashboardPageData, tenantId, {
      supabase,
      buScope,
    }),
    fetchTenantBalanceSheetIntegrityStatus(tenantId),
  ]);
  const viewModel: DashboardViewModel = {
    ...viewModelBase,
    balanceSheetIntegrity,
  };

  const payload = sortKeysDeep({
    metadata: {
      tenant_id: tenantId,
      auth_uid: authUid,
      active_business_unit_id: activeBusinessUnitId,
      view_all_business_units: viewAllBusinessUnits,
      month: monthKey,
      generated_at: new Date().toISOString(),
    },
    ...buildDisplayedSnapshotPayload(
      viewModel,
      monthKey,
      dashboardPageData.fetchError,
    ),
  });

  return NextResponse.json(payload);
}
