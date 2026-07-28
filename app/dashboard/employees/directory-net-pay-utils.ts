import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeRecord } from "./employee-record-utils";
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
} from "../hr-payroll/payroll-processing-utils";
import type { LoanRegisterEntry } from "../hr-payroll/loan-register-utils";
import {
  formatPeriodLabel,
  getPeriodEndDate,
  getPeriodStartDate,
  resolveDefaultDaysToPay,
  resolveSelectedPeriod,
  type SelectedPayrollPeriod,
} from "../hr-payroll/payroll-period-utils";

export type DirectoryNetPayContext = {
  period: SelectedPayrollPeriod;
  periodLabel: string;
  /** employee_id → live-recalculated net pay for the current calendar payroll period */
  netPayByEmployeeId: Record<string, number>;
  /**
   * fromProcessingRow = had a payroll_processing row; manuals taken from it,
   * amounts recalculated with current Salary Settings (never stored net_pay).
   * fromFreshCalculation = no row yet; defaults used.
   */
  stats: {
    fromProcessingRow: number;
    fromFreshCalculation: number;
  };
};

function toPayrollEmployeeSource(
  employee: EmployeeRecord,
): PayrollEmployeeSource {
  return {
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
    employment_type: employee.employment_type,
    employment_status: employee.employment_status,
    date_hired: employee.date_hired,
    appointment_end_date: employee.appointment_end_date,
    position: employee.position,
    shift: employee.shift,
    basic_salary: employee.basic_salary,
    housing_allowance: employee.housing_allowance,
    transport_allowance: employee.transport_allowance,
    other_allowances: employee.other_allowances,
    department: employee.department,
    contract_project: employee.contract_project,
  };
}

/**
 * Current period = calendar month (same default as Payroll Processing
 * `buildPeriodKey(now.getFullYear(), now.getMonth() + 1)`).
 */
export function resolveDirectoryPayrollPeriod(
  referenceDate = new Date(),
): SelectedPayrollPeriod {
  return resolveSelectedPeriod(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
  );
}

export function buildDirectoryNetPayByEmployee(
  employees: EmployeeRecord[],
  period: SelectedPayrollPeriod,
  processingRows: PayrollProcessingRow[],
  attendance: PayrollAttendanceSource[],
  overtime: PayrollOvertimeSource[],
  loans: LoanRegisterEntry[],
  taxConfigs: PayrollTaxConfigs,
  compensationPolicyConfig: PayrollCompensationPolicyConfig,
): Omit<DirectoryNetPayContext, "period" | "periodLabel"> {
  const processingByEmployee = new Map(
    processingRows.map((row) => [row.employee_id, row]),
  );
  const asOf = new Date(getPeriodEndDate(period.year, period.month));
  const netPayByEmployeeId: Record<string, number> = {};
  let fromProcessingRow = 0;
  let fromFreshCalculation = 0;

  for (const employee of employees) {
    const source = toPayrollEmployeeSource(employee);
    const policy = resolvePayrollPolicyCompensation(
      source,
      compensationPolicyConfig,
      asOf,
    );
    const sources = {
      absenceCount: countAbsencesForStaff(
        attendance,
        source.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        overtime,
        source.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        loans,
        source.employee_id,
      ),
    };

    const existing = processingByEmployee.get(employee.employee_id);
    if (existing) {
      // Same path as Payroll Processing recalculateWorkspaceRow:
      // live Salary Settings + live attendance/OT/loans + manuals from the row.
      // Never read stored net_pay — policy changes must show immediately.
      const calculated = calculatePayrollRow(
        source,
        period,
        taxConfigs,
        sources,
        buildManualInputsFromRow(existing, period.totalWorkingDays),
        policy,
      );
      netPayByEmployeeId[employee.employee_id] = calculated.net_pay;
      fromProcessingRow += 1;
      continue;
    }

    // No processing row yet for this open period — fresh default calculation
    // (same pure function Payroll Processing uses on generate/sync).
    const calculated = calculatePayrollRow(
      source,
      period,
      taxConfigs,
      sources,
      {
        days_to_pay: resolveDefaultDaysToPay(source, period),
        bonuses: 0,
        arrears: 0,
        net_only_adjustment: 0,
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
      },
      policy,
    );
    netPayByEmployeeId[employee.employee_id] = calculated.net_pay;
    fromFreshCalculation += 1;
  }

  return {
    netPayByEmployeeId,
    stats: { fromProcessingRow, fromFreshCalculation },
  };
}

/**
 * Batch-load open-period net pay for Employee Directory (RLS-scoped client).
 * One query each for processing / attendance / overtime / loans / tax configs.
 */
export async function loadDirectoryNetPayContext(
  supabase: SupabaseClient,
  tenantId: string | null,
  employees: EmployeeRecord[],
  referenceDate = new Date(),
): Promise<DirectoryNetPayContext> {
  const period = resolveDirectoryPayrollPeriod(referenceDate);
  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);
  const periodLabel = formatPeriodLabel(period.year, period.month);

  const empty: DirectoryNetPayContext = {
    period,
    periodLabel,
    netPayByEmployeeId: {},
    stats: { fromProcessingRow: 0, fromFreshCalculation: 0 },
  };

  if (employees.length === 0) {
    return empty;
  }

  let processingQuery = supabase
    .from("payroll_processing")
    .select("*")
    .eq("payroll_month", period.payrollMonth);
  let attendanceQuery = supabase
    .from("attendance_register")
    .select("staff_id, date, attendance_status")
    .gte("date", periodStart)
    .lte("date", periodEnd);
  let overtimeQuery = supabase
    .from("overtime_register")
    .select("employee_id, date, overtime_amount")
    .gte("date", periodStart)
    .lte("date", periodEnd);
  let loansQuery = supabase.from("loan_register").select("*");
  let salaryRatesQuery = supabase
    .from("salary_rate_config")
    .select("*")
    .order("effective_date", { ascending: false });
  let allowanceTypesQuery = supabase
    .from("allowance_types")
    .select("id, code, name, is_active, sort_order")
    .order("sort_order", { ascending: true });
  let compensationPoliciesQuery = supabase.from("compensation_policy").select("*");
  let ssnitQuery = supabase
    .from("ssnit_rate_config")
    .select("*")
    .order("effective_date", { ascending: false });
  let casualQuery = supabase
    .from("casual_tax_rate_config")
    .select("*")
    .order("effective_date", { ascending: false });
  let payeQuery = supabase
    .from("paye_tax_bands")
    .select("band_order, lower_bound, upper_bound, rate, effective_date")
    .order("effective_date", { ascending: false })
    .order("band_order", { ascending: true });

  if (tenantId) {
    processingQuery = processingQuery.eq("tenant_id", tenantId);
    attendanceQuery = attendanceQuery.eq("tenant_id", tenantId);
    overtimeQuery = overtimeQuery.eq("tenant_id", tenantId);
    loansQuery = loansQuery.eq("tenant_id", tenantId);
    salaryRatesQuery = salaryRatesQuery.eq("tenant_id", tenantId);
    allowanceTypesQuery = allowanceTypesQuery.eq("tenant_id", tenantId);
    compensationPoliciesQuery = compensationPoliciesQuery.eq(
      "tenant_id",
      tenantId,
    );
    ssnitQuery = ssnitQuery.eq("tenant_id", tenantId);
    casualQuery = casualQuery.eq("tenant_id", tenantId);
    payeQuery = payeQuery.eq("tenant_id", tenantId);
  }

  const [
    { data: processingRows },
    { data: attendance },
    { data: overtime },
    { data: loans },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
  ] = await Promise.all([
    processingQuery,
    attendanceQuery,
    overtimeQuery,
    loansQuery,
    salaryRatesQuery,
    allowanceTypesQuery,
    compensationPoliciesQuery,
    ssnitQuery,
    casualQuery,
    payeQuery,
  ]);

  const taxConfigs: PayrollTaxConfigs = {
    ssnitRows: mapSsnitConfigRows(
      (ssnitRows as Record<string, unknown>[] | null) ?? [],
    ),
    casualRows: mapCasualTaxConfigRows(
      (casualRows as Record<string, unknown>[] | null) ?? [],
    ),
    payeBands: mapPayrollPayeBandRows(
      (payeRows as Record<string, unknown>[] | null) ?? [],
    ),
  };

  const built = buildDirectoryNetPayByEmployee(
    employees,
    period,
    (processingRows as PayrollProcessingRow[] | null) ?? [],
    (attendance as PayrollAttendanceSource[] | null) ?? [],
    (overtime as PayrollOvertimeSource[] | null) ?? [],
    (loans as LoanRegisterEntry[] | null) ?? [],
    taxConfigs,
    {
      salaryRates: (salaryRates as PayrollCompensationPolicyConfig["salaryRates"]) ?? [],
      allowanceTypes:
        (allowanceTypes as PayrollCompensationPolicyConfig["allowanceTypes"]) ??
        [],
      compensationPolicies:
        (compensationPolicies as PayrollCompensationPolicyConfig["compensationPolicies"]) ??
        [],
    },
  );

  return {
    period,
    periodLabel,
    ...built,
  };
}
