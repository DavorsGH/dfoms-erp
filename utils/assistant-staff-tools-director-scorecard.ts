import "server-only";

import type { DirectorScorecardChecklistChipStatus } from "@/app/dashboard/director-scorecard-build";
import type { DirectorScorecardSessionScope } from "@/app/dashboard/director-scorecard-load";
import { loadDirectorScorecardForSession } from "@/app/dashboard/director-scorecard-load";
import { parseAssistantYearMonth } from "@/utils/assistant-period-resolve";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  NO_STAFF_ACCOUNT_MESSAGE,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export const DIRECTOR_SCORECARD_ACCESS_DENIED_MESSAGE =
  "The Director's Scorecard is available to directors and administrators only.";

const FINANCIAL_ACTIVITY_EPSILON = 0.005;
const PAYROLL_FOUND_EPSILON = 0.005;

const CASH_CHECKLIST_IDS = new Set(["cash-reserve", "dividend-cash"]);

function checklistStatusLabel(
  status: DirectorScorecardChecklistChipStatus,
): string {
  switch (status) {
    case "done":
      return "Done";
    case "overdue":
      return "Overdue";
    case "todo":
    default:
      return "To do";
  }
}

function hasFinancialActivity(input: {
  revenueGhs: number;
  totalCostsGhs: number;
  payrollCostGhs: number;
}): boolean {
  return (
    Math.abs(input.revenueGhs) > FINANCIAL_ACTIVITY_EPSILON ||
    Math.abs(input.totalCostsGhs) > FINANCIAL_ACTIVITY_EPSILON ||
    input.payrollCostGhs > PAYROLL_FOUND_EPSILON
  );
}

function canAccessDirectorScorecard(role: string): boolean {
  return role === "director" || role === "super_admin";
}

export function formatDirectorScorecardScopeForTool(
  scope: DirectorScorecardSessionScope,
) {
  return {
    tenantId: scope.tenantId,
    storedActiveBusinessUnitId: scope.storedActiveBusinessUnitId,
    resolvedActiveBusinessUnitId: scope.resolvedActiveBusinessUnitId,
    viewAllBusinessUnits: scope.viewAllBusinessUnits,
    businessUnitLabel: scope.businessUnitLabel,
  };
}

export function formatDirectorScorecardToolPayload(
  bundle: Awaited<ReturnType<typeof loadDirectorScorecardForSession>>,
): unknown {
  if ("error" in bundle) {
    return bundle;
  }

  const { scope, snapshot, monthSnapshot, pageData, monthKey } = bundle;
  const payrollCostGhs = monthSnapshot.payroll.totalPayrollCost;

  if (
    !hasFinancialActivity({
      revenueGhs: snapshot.revenue,
      totalCostsGhs: snapshot.totalCosts,
      payrollCostGhs,
    })
  ) {
    return {
      error: `No financial activity found for ${snapshot.periodLabel} in ${scope.businessUnitLabel}. Check the business unit selected in the header.`,
      scope: formatDirectorScorecardScopeForTool(scope),
      monthKey,
      fetchWarning: pageData.fetchError,
    };
  }

  const overBudgetLines = snapshot.budget.rows
    .filter((row) => row.status === "red")
    .map((row) => ({
      line: row.rowLabel,
      category: row.category,
      subcategory: row.subcategory,
      budgetedGhs: row.budgeted,
      actualGhs: row.actual,
      overGhs: Math.max(0, row.actual - row.budgeted),
    }));

  return {
    periodLabel: snapshot.periodLabel,
    year: snapshot.year,
    month: snapshot.month,
    monthKey,
    currency: "GHS" as const,
    scope: formatDirectorScorecardScopeForTool(scope),
    planningDisclaimer:
      "Planning figures for directors — not tax advice. Do not treat as safe to pay a dividend unless all five checklist items are Done.",
    revenueGhs: snapshot.revenue,
    totalCostsGhs: snapshot.totalCosts,
    profitBeforeTaxGhs: snapshot.profitBeforeTax,
    taxToSetAsideGhs: snapshot.taxToSetAside,
    taxDetail: {
      citGhs: snapshot.taxDetail.citAmount,
      gslGhs: snapshot.taxDetail.gslAmount,
      whtCreditAppliedGhs: snapshot.taxDetail.whtCreditApplied,
    },
    profitAfterTaxGhs: snapshot.profitAfterTax,
    profitSplit: {
      reserveGhs: snapshot.reserveAmount,
      reinvestGhs: snapshot.reinvestAmount,
      ownersShareGhs: snapshot.ownersShareAmount,
      reservePercent: 30,
      reinvestPercent: 20,
      ownersPercent: 50,
    },
    cashPositionGhs: monthSnapshot.summary.cashPosition,
    payrollCostGhs,
    dividendQuarter: {
      quarterLabel: snapshot.dividendQuarter.quarterLabel,
      grossGhs: snapshot.dividendQuarter.gross,
      whtGhs: snapshot.dividendQuarter.wht,
      netGhs: snapshot.dividendQuarter.net,
    },
    dividendChecklist: {
      ready: snapshot.checklist.items.every((item) => {
        if (
          CASH_CHECKLIST_IDS.has(item.id) &&
          payrollCostGhs <= PAYROLL_FOUND_EPSILON
        ) {
          return false;
        }
        return item.pass;
      }),
      items: snapshot.checklist.items.map((item) => {
        if (
          CASH_CHECKLIST_IDS.has(item.id) &&
          payrollCostGhs <= PAYROLL_FOUND_EPSILON
        ) {
          return {
            id: item.id,
            label: item.label,
            status: "Not enough data" as const,
            pass: null,
            message: `${item.reason} Payroll was not found for this month in the selected business unit — check the business unit in the header.`,
          };
        }
        return {
          id: item.id,
          label: item.label,
          status: checklistStatusLabel(item.chipStatus),
          pass: item.pass,
          message: item.reason,
        };
      }),
    },
    overBudgetLines,
    fetchWarning: pageData.fetchError,
  };
}

export async function getDirectorScorecard(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }

  if (!canAccessDirectorScorecard(sessionResult.session.role)) {
    return { error: DIRECTOR_SCORECARD_ACCESS_DENIED_MESSAGE };
  }

  const { year, month } = parseAssistantYearMonth(toolInput);
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;

  try {
    const tenantId = await getCurrentUserTenantId();
    if (!tenantId || tenantId !== sessionResult.session.tenantId) {
      return { error: NO_STAFF_ACCOUNT_MESSAGE };
    }

    const bundle = await loadDirectorScorecardForSession(monthKey);
    return formatDirectorScorecardToolPayload(bundle);
  } catch (error) {
    console.error("[assistant] get_director_scorecard threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
