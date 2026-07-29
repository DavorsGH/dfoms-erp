import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeaveManagementEntry } from "../hr-payroll/leave-management-utils";
import type { LoanRegisterEntry } from "../hr-payroll/loan-register-utils";
import {
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  type PayrollAttendanceSource,
  type PayrollOvertimeSource,
  type PayrollProcessingRow,
} from "../hr-payroll/payroll-processing-utils";
import type { MonthEndCloseRecord } from "../hr-payroll/payroll-period-utils";
import {
  buildAvailableHrReportYears,
  type HrReportEmployee,
  type PayrollSummaryLiveContext,
} from "./hr-reports-utils";

const HR_EMPLOYEE_REPORT_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position";

/** Extended employee fields needed for open-period live payroll recalculation. */
const HR_EMPLOYEE_PAYROLL_SUMMARY_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, department, contract_project, basic_salary, housing_allowance, transport_allowance, other_allowances";

/** Locked history: stored snapshot columns only. */
const PAYROLL_HISTORY_ROW_SELECT =
  "payroll_month, employee_id, basic_salary, gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax, loan_repayment, total_deductions, net_pay";

/**
 * Open processing: full row so manuals (days_to_pay, arrears, …) are available
 * for display-only live recalculation. Never mutate these from the report.
 * Uses * so environments without newer columns (e.g. net_only_adjustment) still load.
 */
const PAYROLL_PROCESSING_ROW_SELECT = "*";

async function fetchHrEmployees(supabase: SupabaseClient) {
  return supabase
    .from("employees")
    .select(HR_EMPLOYEE_REPORT_SELECT)
    .order("staff_id", { ascending: true });
}

export async function fetchMonthlyPayrollSummaryReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: employees, error: employeesError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    { data: attendance, error: attendanceError },
    { data: overtime, error: overtimeError },
    { data: loans, error: loansError },
    { data: salaryRates, error: salaryRatesError },
    { data: allowanceTypes, error: allowanceTypesError },
    { data: compensationPolicies, error: compensationPoliciesError },
    { data: ssnitRows, error: ssnitError },
    { data: casualRows, error: casualError },
    { data: payeRows, error: payeError },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(HR_EMPLOYEE_PAYROLL_SUMMARY_SELECT)
      .order("staff_id", { ascending: true }),
    supabase.from("payroll_history").select(PAYROLL_HISTORY_ROW_SELECT),
    supabase.from("payroll_processing").select(PAYROLL_PROCESSING_ROW_SELECT),
    supabase.from("month_end_close").select("*"),
    supabase
      .from("attendance_register")
      .select("staff_id, date, attendance_status"),
    supabase
      .from("overtime_register")
      .select("employee_id, date, overtime_amount"),
    supabase.from("loan_register").select("*"),
    supabase
      .from("salary_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    supabase
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .order("sort_order", { ascending: true }),
    supabase.from("compensation_policy").select("*"),
    supabase
      .from("ssnit_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    supabase
      .from("casual_tax_rate_config")
      .select("*")
      .order("effective_date", { ascending: false }),
    supabase
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  const historyMonths =
    payrollHistory?.map((row) => row.payroll_month.slice(0, 10)) ?? [];
  const processingMonths =
    payrollProcessing?.map((row) => row.payroll_month.slice(0, 10)) ?? [];
  const closeMonths =
    monthEndCloseRecords?.map((row) => row.month.slice(0, 10)) ?? [];

  const liveContext: PayrollSummaryLiveContext = {
    attendance: (attendance as PayrollAttendanceSource[] | null) ?? [],
    overtime: (overtime as PayrollOvertimeSource[] | null) ?? [],
    loans: (loans as LoanRegisterEntry[] | null) ?? [],
    taxConfigs: {
      ssnitRows: mapSsnitConfigRows(
        (ssnitRows as Record<string, unknown>[] | null) ?? [],
      ),
      casualRows: mapCasualTaxConfigRows(
        (casualRows as Record<string, unknown>[] | null) ?? [],
      ),
      payeBands: mapPayrollPayeBandRows(
        (payeRows as Record<string, unknown>[] | null) ?? [],
      ),
    },
    compensationPolicyConfig: {
      salaryRates: salaryRates ?? [],
      allowanceTypes: allowanceTypes ?? [],
      compensationPolicies: compensationPolicies ?? [],
    },
  };

  const liveFetchError =
    attendanceError?.message ??
    overtimeError?.message ??
    loansError?.message ??
    salaryRatesError?.message ??
    allowanceTypesError?.message ??
    compensationPoliciesError?.message ??
    ssnitError?.message ??
    casualError?.message ??
    payeError?.message ??
    null;

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialPayrollHistory:
      (payrollHistory as PayrollProcessingRow[] | null) ?? [],
    initialPayrollProcessing:
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    initialMonthEndCloseRecords:
      (monthEndCloseRecords as MonthEndCloseRecord[] | null) ?? [],
    initialLiveContext: liveContext,
    availableYears: buildAvailableHrReportYears(
      historyMonths,
      processingMonths,
      closeMonths,
    ),
    fetchError:
      employeesError?.message ??
      payrollHistoryError?.message ??
      payrollProcessingError?.message ??
      monthEndCloseError?.message ??
      liveFetchError,
  };
}

export async function fetchAttendanceSummaryReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: employees, error: employeesError },
    { data: attendanceEntries, error: attendanceError },
  ] = await Promise.all([
    fetchHrEmployees(supabase),
    supabase
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .order("date", { ascending: true }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialAttendanceEntries: attendanceEntries ?? [],
    availableYears: buildAvailableHrReportYears(
      attendanceEntries?.map((entry) => entry.date) ?? [],
      employees?.map((entry) => entry.date_hired ?? "") ?? [],
    ),
    fetchError: employeesError?.message ?? attendanceError?.message ?? null,
  };
}

export async function fetchLeaveBalanceReportData(supabase: SupabaseClient) {
  const [
    { data: employees, error: employeesError },
    { data: leaveEntries, error: leaveError },
  ] = await Promise.all([
    fetchHrEmployees(supabase),
    supabase
      .from("leave_management")
      .select("*")
      .order("start_date", { ascending: false }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialLeaveEntries: (leaveEntries as LeaveManagementEntry[] | null) ?? [],
    fetchError: employeesError?.message ?? leaveError?.message ?? null,
  };
}

export async function fetchLoanRegisterSummaryReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: employees, error: employeesError },
    { data: loans, error: loansError },
  ] = await Promise.all([
    fetchHrEmployees(supabase),
    supabase.from("loan_register").select("*").order("date_issued", {
      ascending: false,
    }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialLoans: (loans as LoanRegisterEntry[] | null) ?? [],
    fetchError: employeesError?.message ?? loansError?.message ?? null,
  };
}

export async function fetchOvertimeSummaryReportData(
  supabase: SupabaseClient,
) {
  const [
    { data: employees, error: employeesError },
    { data: overtimeEntries, error: overtimeError },
  ] = await Promise.all([
    fetchHrEmployees(supabase),
    supabase
      .from("overtime_register")
      .select("employee_id, date, overtime_hours, overtime_amount")
      .order("date", { ascending: true }),
  ]);

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    initialOvertimeEntries: overtimeEntries ?? [],
    availableYears: buildAvailableHrReportYears(
      overtimeEntries?.map((entry) => entry.date) ?? [],
    ),
    fetchError: employeesError?.message ?? overtimeError?.message ?? null,
  };
}

export async function fetchHeadcountContractExpiryReportData(
  supabase: SupabaseClient,
) {
  const { data: employees, error: employeesError } = await fetchHrEmployees(
    supabase,
  );

  return {
    initialEmployees: (employees as HrReportEmployee[] | null) ?? [],
    fetchError: employeesError?.message ?? null,
  };
}
