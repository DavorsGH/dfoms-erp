import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type {
  AllowanceTypeRow,
  CompensationPolicyRow,
} from "../administration/compensation-policy-utils";
import type { SalaryRateConfig } from "../employees/pay-estimate-utils";
import { getAttendanceMonthBounds } from "./attendance-register-utils";
import type { LoanRegisterEntry } from "./loan-register-utils";
import {
  buildManualInputsFromRow,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployeeInPeriod,
  type PayrollAttendanceSource,
  type PayrollCompensationPolicyConfig,
  type PayrollEmployeeSource,
  type PayrollHistoryRow,
  type PayrollOvertimeSource,
  type PayrollProcessingRow,
  type PayrollTaxConfigs,
} from "./payroll-processing-utils";
import { fetchStatutoryPayrollTaxConfigs } from "./statutory-payroll-config-utils";
import {
  HR_PAYROLL_SETTINGS_SELECT,
  normalizeHrPayrollSettingsRow,
  resolvePayrollWelfareConfigForEmployee,
  type HrPayrollSettingsRow,
} from "@/utils/hr-payroll-settings-types";
import {
  getPeriodEndDate,
  isMonthClosed,
  resolveSelectedPeriod,
  type MonthEndCloseRecord,
  type SelectedPayrollPeriod,
} from "./payroll-period-utils";

const PAYROLL_EMPLOYEE_SELECT =
  "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, business_unit_id, department, contract_project, payment_method, bank_name, account_number, momo_number, momo_name";

export type PayrollWorkspaceSnapshotAllowanceLine = {
  allowance_code: string;
  allowance_name: string;
  amount: number;
};

export type PayrollWorkspaceSnapshotEmployee = {
  staff_id: string;
  days_to_pay: number | null;
  daily_rate: number | null;
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  allowance_lines: PayrollWorkspaceSnapshotAllowanceLine[];
  allowance_total: number;
  absence_deduction: number | null;
  overtime_amount: number | null;
  bonuses: number | null;
  arrears: number | null;
  net_only_adjustment: number | null;
  gross_pay: number | null;
  employee_ssnit: number | null;
  employer_ssnit: number | null;
  tier2: number | null;
  employer_ssnit_cost: number | null;
  paye_tax: number | null;
  overtime_tax: number | null;
  loan_repayment: number | null;
  salary_advance: number | null;
  welfare_deduction: number | null;
  other_deductions: number | null;
  total_deductions: number | null;
  net_pay: number | null;
};

export type PayrollWorkspaceSnapshotPayload = {
  metadata: {
    tenant_id: string;
    auth_uid: string;
    active_business_unit_id: string | null;
    view_all_business_units: boolean;
    business_unit_read_scope: BusinessUnitReadScope;
    period: string;
    payroll_month: string;
    period_status: "open" | "closed";
    total_working_days: number;
    generated_at: string;
  };
  employees: Record<string, PayrollWorkspaceSnapshotEmployee>;
  fetch_error: string | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function allowanceTotalFromLines(
  lines: PayrollWorkspaceSnapshotAllowanceLine[],
): number {
  return lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
}

function allowanceLinesFromPolicy(
  employee: PayrollEmployeeSource,
  period: SelectedPayrollPeriod,
  compensationPolicyConfig: PayrollCompensationPolicyConfig,
): PayrollWorkspaceSnapshotAllowanceLine[] {
  const policy = resolvePayrollPolicyCompensation(
    employee,
    compensationPolicyConfig,
    new Date(getPeriodEndDate(period.year, period.month)),
  );
  if (!policy) {
    return [];
  }
  return policy.allowance_lines.map((line) => ({
    allowance_code: line.allowance_code,
    allowance_name: line.allowance_name,
    amount: Number(line.amount) || 0,
  }));
}

function allowanceLinesFromStoredRows(
  rows: Array<{
    allowance_code: string;
    allowance_name: string;
    amount: number | null;
  }>,
): PayrollWorkspaceSnapshotAllowanceLine[] {
  return rows.map((row) => ({
    allowance_code: row.allowance_code,
    allowance_name: row.allowance_name,
    amount: Number(row.amount) || 0,
  }));
}

function snapshotEmployeeFromCalculated(
  employee: PayrollEmployeeSource,
  period: SelectedPayrollPeriod,
  compensationPolicyConfig: PayrollCompensationPolicyConfig,
  calculated: ReturnType<typeof calculatePayrollRow>,
): PayrollWorkspaceSnapshotEmployee {
  const allowance_lines = allowanceLinesFromPolicy(
    employee,
    period,
    compensationPolicyConfig,
  );
  const employerSsnit = num(calculated.employer_ssnit) ?? 0;
  const tier2 = num(calculated.tier2) ?? 0;

  return {
    staff_id: employee.staff_id,
    days_to_pay: num(calculated.days_to_pay),
    daily_rate: num(calculated.daily_rate),
    basic_salary: num(calculated.basic_salary),
    housing_allowance: num(calculated.housing_allowance),
    transport_allowance: num(calculated.transport_allowance),
    other_allowances: num(calculated.other_allowances),
    allowance_lines,
    allowance_total: allowanceTotalFromLines(allowance_lines),
    absence_deduction: num(calculated.absence_deduction),
    overtime_amount: num(calculated.overtime_amount),
    bonuses: num(calculated.bonuses),
    arrears: num(calculated.arrears),
    net_only_adjustment: num(calculated.net_only_adjustment),
    gross_pay: num(calculated.gross_pay),
    employee_ssnit: num(calculated.employee_ssnit),
    employer_ssnit: num(calculated.employer_ssnit),
    tier2: num(calculated.tier2),
    employer_ssnit_cost: employerSsnit + tier2,
    paye_tax: num(calculated.paye_tax),
    overtime_tax: num(calculated.overtime_tax),
    loan_repayment: num(calculated.loan_repayment),
    salary_advance: num(calculated.salary_advance),
    welfare_deduction: num(calculated.welfare_deduction),
    other_deductions: num(calculated.other_deductions),
    total_deductions: num(calculated.total_deductions),
    net_pay: num(calculated.net_pay),
  };
}

function snapshotEmployeeFromHistoryRow(
  employee: PayrollEmployeeSource,
  row: PayrollHistoryRow,
  storedAllowanceLines: PayrollWorkspaceSnapshotAllowanceLine[],
): PayrollWorkspaceSnapshotEmployee {
  const employerSsnit = num(row.employer_ssnit) ?? 0;
  const tier2 = num(row.tier2) ?? 0;
  const allowance_total =
    storedAllowanceLines.length > 0
      ? allowanceTotalFromLines(storedAllowanceLines)
      : (num(row.housing_allowance) ?? 0) +
        (num(row.transport_allowance) ?? 0) +
        (num(row.other_allowances) ?? 0);

  return {
    staff_id: employee.staff_id,
    days_to_pay: num(row.days_to_pay),
    daily_rate: num(row.daily_rate),
    basic_salary: num(row.basic_salary),
    housing_allowance: num(row.housing_allowance),
    transport_allowance: num(row.transport_allowance),
    other_allowances: num(row.other_allowances),
    allowance_lines: storedAllowanceLines,
    allowance_total,
    absence_deduction: num(row.absence_deduction),
    overtime_amount: num(row.overtime_amount),
    bonuses: num(row.bonuses),
    arrears: num(row.arrears),
    net_only_adjustment: num(row.net_only_adjustment),
    gross_pay: num(row.gross_pay),
    employee_ssnit: num(row.employee_ssnit),
    employer_ssnit: num(row.employer_ssnit),
    tier2: num(row.tier2),
    employer_ssnit_cost: employerSsnit + tier2,
    paye_tax: num(row.paye_tax),
    overtime_tax: num(row.overtime_tax),
    loan_repayment: num(row.loan_repayment),
    salary_advance: num(row.salary_advance),
    welfare_deduction: num(row.welfare_deduction),
    other_deductions: num(row.other_deductions),
    total_deductions: num(row.total_deductions),
    net_pay: num(row.net_pay),
  };
}

async function fetchMonthEndCloseForScope(
  supabase: SupabaseClient,
  payrollMonth: string,
  buScope: BusinessUnitReadScope,
): Promise<MonthEndCloseRecord | null> {
  if (buScope.mode === "all") {
    return null;
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase.from("month_end_close").select("*").eq("month", payrollMonth),
    buScope,
  ).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as MonthEndCloseRecord | null) ?? null;
}

export async function buildPayrollWorkspaceSnapshot(input: {
  supabase: SupabaseClient;
  tenantId: string;
  authUid: string;
  activeBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  buScope: BusinessUnitReadScope;
  periodKey: string;
  year: number;
  month: number;
}): Promise<PayrollWorkspaceSnapshotPayload> {
  const {
    supabase,
    tenantId,
    authUid,
    activeBusinessUnitId,
    viewAllBusinessUnits,
    buScope,
    periodKey,
    year,
    month,
  } = input;

  const period = resolveSelectedPeriod(year, month);
  const { start: attendanceStart, end: attendanceEnd } =
    getAttendanceMonthBounds(year, month);
  const admin = createAdminClient();

  const [
    { data: employeesData, error: employeesError },
    { data: attendanceData, error: attendanceError },
    { data: overtimeData, error: overtimeError },
    { data: loansData, error: loansError },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    statutoryTaxBundle,
    monthEndClose,
    { data: hrPayrollSettingsData, error: hrPayrollSettingsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("employees")
        .select(PAYROLL_EMPLOYEE_SELECT)
        .eq("tenant_id", tenantId)
        .order("staff_id", { ascending: true }),
      buScope,
    ),
    supabase
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .gte("date", attendanceStart)
      .lte("date", attendanceEnd),
    supabase
      .from("overtime_register")
      .select("employee_id, date, overtime_amount, approved_by")
      .gte("date", attendanceStart)
      .lte("date", attendanceEnd),
    supabase
      .from("loan_register")
      .select("*")
      .or("outstanding_balance.gt.0.01,outstanding_balance.is.null"),
    supabase
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    supabase
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("compensation_policy")
      .select("*")
      .eq("tenant_id", tenantId),
    fetchStatutoryPayrollTaxConfigs(admin),
    fetchMonthEndCloseForScope(supabase, period.payrollMonth, buScope),
    admin
      .from("hr_payroll_settings")
      .select(HR_PAYROLL_SETTINGS_SELECT)
      .eq("tenant_id", tenantId),
  ]);

  const hrPayrollSettingsRows = (
    (hrPayrollSettingsData as HrPayrollSettingsRow[] | null) ?? []
  )
    .map((row) => normalizeHrPayrollSettingsRow(row))
    .filter((row): row is HrPayrollSettingsRow => row !== null);

  const fetchError =
    employeesError?.message ??
    attendanceError?.message ??
    overtimeError?.message ??
    loansError?.message ??
    statutoryTaxBundle.error ??
    hrPayrollSettingsError?.message ??
    null;

  const employees = (employeesData as PayrollEmployeeSource[] | null) ?? [];
  const employeeMap = new Map(
    employees.map((employee) => [employee.employee_id, employee]),
  );
  const attendance =
    (attendanceData as PayrollAttendanceSource[] | null) ?? [];
  const overtime = (overtimeData as PayrollOvertimeSource[] | null) ?? [];
  const loans = (loansData as LoanRegisterEntry[] | null) ?? [];
  const compensationPolicyConfig: PayrollCompensationPolicyConfig = {
    salaryRates: (salaryRates as SalaryRateConfig[] | null) ?? [],
    allowanceTypes: (allowanceTypes as AllowanceTypeRow[] | null) ?? [],
    compensationPolicies:
      (compensationPolicies as CompensationPolicyRow[] | null) ?? [],
  };
  const taxConfigs: PayrollTaxConfigs = statutoryTaxBundle.taxConfigs;

  const periodClosed = isMonthClosed(monthEndClose);
  const allowanceStage = periodClosed ? "history" : "processing";

  const { data: allowanceLineRows, error: allowanceLinesError } = await supabase
    .from("payroll_allowance_lines")
    .select("employee_id, allowance_code, allowance_name, amount")
    .eq("payroll_month", period.payrollMonth)
    .eq("stage", allowanceStage);

  if (allowanceLinesError) {
    throw new Error(allowanceLinesError.message);
  }

  const allowanceLinesByEmployee = new Map<
    string,
    PayrollWorkspaceSnapshotAllowanceLine[]
  >();
  for (const line of allowanceLineRows ?? []) {
    const employeeId = String(
      (line as { employee_id: string }).employee_id ?? "",
    );
    if (!employeeId) {
      continue;
    }
    const bucket = allowanceLinesByEmployee.get(employeeId) ?? [];
    bucket.push({
      allowance_code: String(
        (line as { allowance_code: string }).allowance_code ?? "",
      ),
      allowance_name: String(
        (line as { allowance_name: string }).allowance_name ?? "",
      ),
      amount: Number((line as { amount: number | null }).amount) || 0,
    });
    allowanceLinesByEmployee.set(employeeId, bucket);
  }

  let payrollRows: (PayrollProcessingRow | PayrollHistoryRow)[] = [];

  if (periodClosed) {
    const { data, error: historyError } = await supabase
      .from("payroll_history")
      .select("*")
      .eq("payroll_month", period.payrollMonth)
      .order("employee_id", { ascending: true });

    if (historyError) {
      throw new Error(historyError.message);
    }

    payrollRows = ((data as PayrollHistoryRow[] | null) ?? []).filter((row) =>
      employeeMap.has(row.employee_id),
    );
  } else {
    const { data, error: processingError } = await supabase
      .from("payroll_processing")
      .select("*")
      .eq("payroll_month", period.payrollMonth)
      .order("employee_id", { ascending: true });

    if (processingError) {
      throw new Error(processingError.message);
    }

    payrollRows = ((data as PayrollProcessingRow[] | null) ?? []).filter((row) =>
      employeeMap.has(row.employee_id),
    );
  }

  const employeesOut: Record<string, PayrollWorkspaceSnapshotEmployee> = {};

  for (const row of payrollRows) {
    const employee = employeeMap.get(row.employee_id);
    if (!employee) {
      continue;
    }

    if (periodClosed) {
      const storedLines =
        allowanceLinesByEmployee.get(row.employee_id) ?? [];
      employeesOut[row.employee_id] = snapshotEmployeeFromHistoryRow(
        employee,
        row as PayrollHistoryRow,
        storedLines,
      );
      continue;
    }

    const absenceCount = countAbsencesForStaff(
      attendance,
      employee.staff_id,
      period.year,
      period.month,
    );
    const overtimeAmount = sumOvertimeForEmployeeInPeriod(
      overtime,
      employee.employee_id,
      period,
    );
    const loanRepayment = calculateLoanRepaymentForEmployee(
      loans,
      employee.employee_id,
    );
    const policy = resolvePayrollPolicyCompensation(
      employee,
      compensationPolicyConfig,
      new Date(getPeriodEndDate(period.year, period.month)),
    );

    const calculated = calculatePayrollRow(
      employee,
      period,
      taxConfigs,
      { absenceCount, overtimeAmount, loanRepayment },
      buildManualInputsFromRow(row, period.totalWorkingDays),
      policy,
      resolvePayrollWelfareConfigForEmployee(
        employee.business_unit_id,
        hrPayrollSettingsRows,
      ),
    );

    employeesOut[row.employee_id] = snapshotEmployeeFromCalculated(
      employee,
      period,
      compensationPolicyConfig,
      calculated,
    );
  }

  return {
    metadata: {
      tenant_id: tenantId,
      auth_uid: authUid,
      active_business_unit_id: activeBusinessUnitId,
      view_all_business_units: viewAllBusinessUnits,
      business_unit_read_scope: buScope,
      period: periodKey,
      payroll_month: period.payrollMonth,
      period_status: periodClosed ? "closed" : "open",
      total_working_days: period.totalWorkingDays,
      generated_at: new Date().toISOString(),
    },
    employees: employeesOut,
    fetch_error: fetchError,
  };
}

/** Deep-sort object keys for stable snapshot diffs. */
export function sortPayrollSnapshotKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortPayrollSnapshotKeysDeep(entry));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortPayrollSnapshotKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}
