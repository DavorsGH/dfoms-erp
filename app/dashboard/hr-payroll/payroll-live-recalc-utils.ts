/**
 * Shared display-only live payroll recalculation for open (non-history) months.
 * Same formula as Payroll Processing recalculateWorkspaceRow / Directory Current Net Pay.
 * Never writes to payroll_processing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoanRegisterEntry } from "./loan-register-utils";
import {
  buildManualInputsFromRow,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
  type PayrollAttendanceSource,
  type PayrollCompensationPolicyConfig,
  type PayrollEmployeeSource,
  type PayrollOvertimeSource,
  type PayrollProcessingRow,
  type PayrollTaxConfigs,
} from "./payroll-processing-utils";
import {
  getPeriodEndDate,
  resolveSelectedPeriod,
} from "./payroll-period-utils";
import type { PayrollHistoryWagesEntry } from "../finance/accrued-wages-utils";
import {
  mergePayrollWagesSources,
  normalizePayrollMonthKey,
} from "../finance/accrued-wages-utils";

export type PayrollLiveRecalcEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  employment_status?: string | null;
  date_hired?: string | null;
  appointment_end_date?: string | null;
  position?: string | null;
  shift?: string | null;
  department?: string | null;
  contract_project: string | null;
  basic_salary?: number | null;
  housing_allowance?: number | null;
  transport_allowance?: number | null;
  other_allowances?: number | null;
};

export type PayrollLiveRecalcContext = {
  attendance: PayrollAttendanceSource[];
  overtime: PayrollOvertimeSource[];
  loans: LoanRegisterEntry[];
  taxConfigs: PayrollTaxConfigs;
  compensationPolicyConfig: PayrollCompensationPolicyConfig;
};

export const PAYROLL_LIVE_RECALC_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, department, contract_project, basic_salary, housing_allowance, transport_allowance, other_allowances";

function toPayrollEmployeeSource(
  employee: PayrollLiveRecalcEmployee,
): PayrollEmployeeSource {
  return {
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
    employment_type: employee.employment_type,
    employment_status: employee.employment_status ?? null,
    date_hired: employee.date_hired ?? null,
    appointment_end_date: employee.appointment_end_date ?? null,
    position: employee.position ?? null,
    shift: employee.shift ?? null,
    basic_salary: employee.basic_salary ?? null,
    housing_allowance: employee.housing_allowance ?? null,
    transport_allowance: employee.transport_allowance ?? null,
    other_allowances: employee.other_allowances ?? null,
    department: employee.department ?? null,
    contract_project: employee.contract_project,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

// PostgrestFilterBuilder generics are too deep for a typed wrapper (TS2589).
// Keep tenant filtering untyped; callers cast results as needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withOptionalTenant(query: any, tenantId: string | undefined) {
  return tenantId ? query.eq("tenant_id", tenantId) : query;
}

/**
 * Batch-load Salary Settings + attendance/OT/loans + employees for live recalc.
 * RLS-scoped when using a user client; pass `tenantId` for service-role scripts.
 */
export async function fetchPayrollLiveRecalcBundle(
  supabase: SupabaseClient,
  options?: { tenantId?: string },
): Promise<{
  employees: PayrollLiveRecalcEmployee[];
  liveContext: PayrollLiveRecalcContext;
  error: string | null;
}> {
  const tenantId = options?.tenantId;

  const [
    { data: employees, error: employeesError },
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
    withOptionalTenant(
      supabase.from("employees").select(PAYROLL_LIVE_RECALC_EMPLOYEE_SELECT),
      tenantId,
    ).order("staff_id", { ascending: true }),
    withOptionalTenant(
      supabase
        .from("attendance_register")
        .select("staff_id, date, attendance_status"),
      tenantId,
    ),
    withOptionalTenant(
      supabase
        .from("overtime_register")
        .select("employee_id, date, overtime_amount"),
      tenantId,
    ),
    withOptionalTenant(supabase.from("loan_register").select("*"), tenantId),
    withOptionalTenant(
      supabase.from("salary_rate_config").select("*"),
      tenantId,
    ).order("effective_date", { ascending: false }),
    withOptionalTenant(
      supabase
        .from("allowance_types")
        .select("id, code, name, is_active, sort_order"),
      tenantId,
    ).order("sort_order", { ascending: true }),
    withOptionalTenant(
      supabase.from("compensation_policy").select("*"),
      tenantId,
    ),
    withOptionalTenant(
      supabase.from("ssnit_rate_config").select("*"),
      tenantId,
    ).order("effective_date", { ascending: false }),
    withOptionalTenant(
      supabase.from("casual_tax_rate_config").select("*"),
      tenantId,
    ).order("effective_date", { ascending: false }),
    withOptionalTenant(
      supabase
        .from("paye_tax_bands")
        .select("band_order, lower_bound, upper_bound, rate, effective_date"),
      tenantId,
    )
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  return {
    employees: (employees as PayrollLiveRecalcEmployee[] | null) ?? [],
    liveContext: {
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
    },
    error:
      employeesError?.message ??
      attendanceError?.message ??
      overtimeError?.message ??
      loansError?.message ??
      salaryRatesError?.message ??
      allowanceTypesError?.message ??
      compensationPoliciesError?.message ??
      ssnitError?.message ??
      casualError?.message ??
      payeError?.message ??
      null,
  };
}

/**
 * Live-recalculate net_pay (and net_only_adjustment) for payroll_processing rows
 * whose payroll_month is NOT already present in payroll_history (locked snapshot wins).
 */
export function buildLiveOpenMonthPayrollWagesEntries(
  processingRows: PayrollProcessingRow[],
  employees: PayrollLiveRecalcEmployee[],
  liveContext: PayrollLiveRecalcContext,
  historyMonths: Iterable<string>,
): PayrollHistoryWagesEntry[] {
  const historyMonthSet = new Set(
    [...historyMonths].map((month) => normalizePayrollMonthKey(month)),
  );
  const employeeById = new Map(
    employees.map((employee) => [employee.employee_id, employee]),
  );

  const entries: PayrollHistoryWagesEntry[] = [];

  for (const row of processingRows) {
    const payrollMonth = normalizePayrollMonthKey(row.payroll_month);
    if (historyMonthSet.has(payrollMonth)) {
      continue;
    }

    const employee = employeeById.get(row.employee_id);
    if (!employee) {
      // No employee master — fall back to stored processing amounts.
      entries.push({
        payroll_month: payrollMonth,
        net_pay: Number(row.net_pay) || 0,
        net_only_adjustment: Number(row.net_only_adjustment) || 0,
      });
      continue;
    }

    const year = Number(payrollMonth.slice(0, 4));
    const month = Number(payrollMonth.slice(5, 7));
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      entries.push({
        payroll_month: payrollMonth,
        net_pay: Number(row.net_pay) || 0,
        net_only_adjustment: Number(row.net_only_adjustment) || 0,
      });
      continue;
    }

    const period = resolveSelectedPeriod(year, month);
    const source = toPayrollEmployeeSource(employee);
    const policy = resolvePayrollPolicyCompensation(
      source,
      liveContext.compensationPolicyConfig,
      new Date(getPeriodEndDate(period.year, period.month)),
    );
    const manuals = buildManualInputsFromRow(row, period.totalWorkingDays);
    const calculated = calculatePayrollRow(
      source,
      period,
      liveContext.taxConfigs,
      {
        absenceCount: countAbsencesForStaff(
          liveContext.attendance,
          source.staff_id,
          period.year,
          period.month,
        ),
        overtimeAmount: sumOvertimeForEmployee(
          liveContext.overtime,
          source.employee_id,
          period.year,
          period.month,
        ),
        loanRepayment: calculateLoanRepaymentForEmployee(
          liveContext.loans,
          source.employee_id,
        ),
      },
      manuals,
      policy,
    );

    entries.push({
      payroll_month: payrollMonth,
      net_pay: roundCurrency(calculated.net_pay),
      net_only_adjustment: roundCurrency(calculated.net_only_adjustment),
    });
  }

  return entries;
}

/**
 * History (locked) rows unchanged; open months live-recalculated then merged
 * via the same month-precedence rules as mergePayrollWagesSources.
 */
export function mergePayrollWagesWithLiveOpenMonths(
  payrollHistory: PayrollHistoryWagesEntry[],
  payrollProcessing: PayrollProcessingRow[],
  employees: PayrollLiveRecalcEmployee[],
  liveContext: PayrollLiveRecalcContext,
): PayrollHistoryWagesEntry[] {
  const historyMonths = payrollHistory.map((entry) => entry.payroll_month);
  const liveOpenEntries = buildLiveOpenMonthPayrollWagesEntries(
    payrollProcessing,
    employees,
    liveContext,
    historyMonths,
  );

  return mergePayrollWagesSources(payrollHistory, liveOpenEntries);
}
