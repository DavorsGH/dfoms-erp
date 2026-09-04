import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { LeaveManagementEntry } from "../hr-payroll/leave-management-utils";
import type { LoanRegisterEntry } from "../hr-payroll/loan-register-utils";
import {
  applyEmployeeIdScope,
  applyStaffIdScope,
  fetchScopedEmployeeIds,
  fetchScopedStaffIds,
} from "../hr-payroll/payroll-bu-scope-utils";
import { fetchPayrollLiveRecalcBundle } from "../hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../hr-payroll/payroll-processing-utils";
import type { MonthEndCloseRecord } from "../hr-payroll/payroll-period-utils";
import {
  buildAvailableHrReportYears,
  type HrReportEmployee,
  type PayrollSummaryLiveContext,
} from "./hr-reports-utils";

const HR_EMPLOYEE_REPORT_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position";

/** Locked history: stored snapshot columns only. */
const PAYROLL_HISTORY_ROW_SELECT =
  "payroll_month, employee_id, basic_salary, gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax, loan_repayment, total_deductions, net_pay";

/**
 * Open processing: full row so manuals (days_to_pay, arrears, …) are available
 * for display-only live recalculation. Never mutate these from the report.
 * Uses * so environments without newer columns (e.g. net_only_adjustment) still load.
 */
const PAYROLL_PROCESSING_ROW_SELECT = "*";

async function fetchHrEmployees(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  return applyBusinessUnitScope(
    supabase.from("employees").select(HR_EMPLOYEE_REPORT_SELECT),
    buScope,
  ).order("staff_id", { ascending: true });
}

export async function fetchMonthlyPayrollSummaryReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedEmployees = await fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );

  const [
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    liveBundle,
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase.from("payroll_history").select(PAYROLL_HISTORY_ROW_SELECT),
      scopedEmployees.employeeIds,
    ),
    applyEmployeeIdScope(
      supabase.from("payroll_processing").select(PAYROLL_PROCESSING_ROW_SELECT),
      scopedEmployees.employeeIds,
    ),
    applyBusinessUnitScope(
      supabase.from("month_end_close").select("*"),
      buScope,
    ),
    fetchPayrollLiveRecalcBundle(supabase, { tenantId, buScope }),
  ]);

  const historyMonths =
    payrollHistory?.map((row) => row.payroll_month.slice(0, 10)) ?? [];
  const processingMonths =
    payrollProcessing?.map((row) => row.payroll_month.slice(0, 10)) ?? [];
  const closeMonths =
    monthEndCloseRecords?.map((row) => row.month.slice(0, 10)) ?? [];

  return {
    initialEmployees: liveBundle.employees as HrReportEmployee[],
    initialPayrollHistory:
      (payrollHistory as PayrollProcessingRow[] | null) ?? [],
    initialPayrollProcessing:
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    initialMonthEndCloseRecords:
      (monthEndCloseRecords as MonthEndCloseRecord[] | null) ?? [],
    initialLiveContext: liveBundle.liveContext as PayrollSummaryLiveContext,
    availableYears: buildAvailableHrReportYears(
      historyMonths,
      processingMonths,
      closeMonths,
    ),
    fetchError:
      scopedEmployees.error ??
      payrollHistoryError?.message ??
      payrollProcessingError?.message ??
      monthEndCloseError?.message ??
      liveBundle.error,
  };
}

export async function fetchAttendanceSummaryReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedStaff = await fetchScopedStaffIds(supabase, tenantId, buScope);

  const [
    { data: employees, error: employeesError },
    { data: attendanceEntries, error: attendanceError },
  ] = await Promise.all([
    fetchHrEmployees(supabase, buScope),
    applyStaffIdScope(
      supabase
        .from("attendance_register")
        .select("staff_id, date, attendance_status"),
      scopedStaff.staffIds,
    ).order("date", { ascending: true }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialAttendanceEntries: attendanceEntries ?? [],
    availableYears: buildAvailableHrReportYears(
      attendanceEntries?.map((entry) => entry.date) ?? [],
      employees?.map((entry) => entry.date_hired ?? "") ?? [],
    ),
    fetchError:
      scopedStaff.error ??
      employeesError?.message ??
      attendanceError?.message ??
      null,
  };
}

export async function fetchLeaveBalanceReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedEmployees = await fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );

  const [
    { data: employees, error: employeesError },
    { data: leaveEntries, error: leaveError },
  ] = await Promise.all([
    fetchHrEmployees(supabase, buScope),
    applyEmployeeIdScope(
      supabase.from("leave_management").select("*"),
      scopedEmployees.employeeIds,
    ).order("start_date", { ascending: false }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialLeaveEntries: (leaveEntries as LeaveManagementEntry[] | null) ?? [],
    fetchError:
      scopedEmployees.error ??
      employeesError?.message ??
      leaveError?.message ??
      null,
  };
}

export async function fetchLoanRegisterSummaryReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedEmployees = await fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );

  const [
    { data: employees, error: employeesError },
    { data: loans, error: loansError },
  ] = await Promise.all([
    fetchHrEmployees(supabase, buScope),
    applyEmployeeIdScope(
      supabase.from("loan_register").select("*"),
      scopedEmployees.employeeIds,
    ).order("date_issued", {
      ascending: false,
    }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialLoans: (loans as LoanRegisterEntry[] | null) ?? [],
    fetchError:
      scopedEmployees.error ??
      employeesError?.message ??
      loansError?.message ??
      null,
  };
}

export async function fetchOvertimeSummaryReportData(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const scopedEmployees = await fetchScopedEmployeeIds(
    supabase,
    tenantId,
    buScope,
  );

  const [
    { data: employees, error: employeesError },
    { data: overtimeEntries, error: overtimeError },
  ] = await Promise.all([
    fetchHrEmployees(supabase, buScope),
    applyEmployeeIdScope(
      supabase
        .from("overtime_register")
        .select("employee_id, date, overtime_hours, overtime_amount"),
      scopedEmployees.employeeIds,
    ).order("date", { ascending: true }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialOvertimeEntries: overtimeEntries ?? [],
    availableYears: buildAvailableHrReportYears(
      overtimeEntries?.map((entry) => entry.date) ?? [],
    ),
    fetchError:
      scopedEmployees.error ??
      employeesError?.message ??
      overtimeError?.message ??
      null,
  };
}

export async function fetchHeadcountContractExpiryReportData(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
) {
  const { data: employees, error: employeesError } = await fetchHrEmployees(
    supabase,
    buScope,
  );

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    fetchError: employeesError?.message ?? null,
  };
}
