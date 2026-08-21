import "server-only";

import { buildHeadcountSummary } from "@/app/dashboard/reports/hr-reports-utils";
import { fetchHeadcountContractExpiryReportData } from "@/app/dashboard/reports/hr-report-data";
import {
  canAccessHrManagementSection,
  canAccessHrPayrollSection,
} from "@/utils/rbac-access";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  loadStaffDashboardViewModel,
  pickMonthSnapshot,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";

export async function getEmployeeHeadcount(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee headcount data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const data = await fetchHeadcountContractExpiryReportData(supabase);
    const summary = buildHeadcountSummary(data.initialEmployees);

    return {
      totalActive: summary.totalActive,
      totalFullTime: summary.totalFullTime,
      totalPartTime: summary.totalPartTime,
      totalCasual: summary.totalCasual,
      totalContract: summary.totalContract,
      totalInactiveTerminated: summary.totalInactiveTerminated,
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_headcount threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getPayrollStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to payroll status data." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const snapshot = pickMonthSnapshot(
    dashboardResult.viewModel,
    dashboardResult.viewModel.defaultMonthKey,
  );
  if (!snapshot) {
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }

  const { payroll } = snapshot;
  return {
    periodLabel: payroll.periodLabel,
    lockStatus: payroll.lockStatus,
    totalPayrollCostGhs: payroll.totalPayrollCost,
    totalPayrollCostYtdGhs: payroll.totalPayrollCostYtd,
    pendingPayrollLiabilitiesGhs: payroll.pendingPayrollLiabilities,
    liabilityReferenceLabel: payroll.liabilityReferenceLabel,
    payrollNotProcessed: payroll.payrollNotProcessed,
    fetchWarning: dashboardResult.fetchError,
  };
}
