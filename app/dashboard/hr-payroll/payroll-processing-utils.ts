import {
  calculatePayeTax,
  mapPayeBandFromRecord,
  normalizeEffectiveDateKey,
  type PayeTaxBand,
} from "../employees/pay-estimate-utils";
import { calculateLoanOutstanding } from "./hr-register-utils";
import type { LoanRegisterEntry } from "./loan-register-utils";
import {
  getPeriodEndDate,
  isDateInPayrollMonth,
  type SelectedPayrollPeriod,
} from "./payroll-period-utils";

export type PayrollProcessingRow = {
  id: string;
  payroll_month: string;
  status: string | null;
  employee_id: string;
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  department: string | null;
  project_contract: string | null;
  daily_rate: number | null;
  days_to_pay: number | null;
  absence_deduction: number | null;
  overtime_amount: number | null;
  loan_repayment: number | null;
  bonuses: number | null;
  arrears: number | null;
  salary_advance: number | null;
  welfare_deduction: number | null;
  other_deductions: number | null;
  gross_pay: number | null;
  employee_ssnit: number | null;
  employer_ssnit: number | null;
  tier2: number | null;
  paye_tax: number | null;
  total_deductions: number | null;
  net_pay: number | null;
};

export type PayrollHistoryRow = PayrollProcessingRow & {
  locked: boolean;
  locked_at: string | null;
};

export type PayrollEmployeeSource = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  employment_status: string | null;
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  department: string | null;
  contract_project: string | null;
};

export type PayrollAttendanceSource = {
  staff_id: string;
  date: string;
  attendance_status: string;
};

export type PayrollOvertimeSource = {
  employee_id: string;
  date: string;
  overtime_amount: number | null;
};

export type PayrollSsnitConfig = {
  effective_date: string;
  employee_rate: number;
  employer_tier1_rate: number;
  employer_tier2_rate: number;
  insurable_earnings_ceiling: number;
};

export type PayrollCasualTaxConfig = {
  effective_date: string;
  flat_rate: number;
};

export type PayrollPayeBand = {
  effective_date: string;
  band_order?: number;
  band_from: number;
  band_to: number | null;
  rate: number;
};

export type PayrollTaxConfigs = {
  ssnitRows: PayrollSsnitConfig[];
  casualRows: PayrollCasualTaxConfig[];
  payeBands: PayrollPayeBand[];
};

export type PayrollManualInputs = {
  days_to_pay: number;
  bonuses: number;
  arrears: number;
  salary_advance: number;
  welfare_deduction: number;
  other_deductions: number;
};

export type PayrollCalculatedRow = PayrollManualInputs & {
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: number;
  daily_rate: number;
  absence_deduction: number;
  overtime_amount: number;
  loan_repayment: number;
  gross_pay: number;
  employee_ssnit: number;
  employer_ssnit: number;
  tier2: number;
  paye_tax: number;
  total_deductions: number;
  net_pay: number;
};

function normalizeRate(rate: number): number {
  if (!Number.isFinite(rate)) {
    return 0;
  }

  return rate > 1 ? rate / 100 : rate;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function pickLatestByEffectiveDate<T extends { effective_date: string }>(
  rows: T[],
  asOf: string,
): T | null {
  const matches = rows.filter(
    (row) => row.effective_date.slice(0, 10) <= asOf.slice(0, 10),
  );

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) =>
    right.effective_date.slice(0, 10).localeCompare(left.effective_date.slice(0, 10)),
  );

  return matches[0];
}

export function pickPayeBandsForDate(
  bands: PayrollPayeBand[],
  asOf: string,
): PayeTaxBand[] {
  if (bands.length === 0) {
    return [];
  }

  const asOfDate = asOf.slice(0, 10);
  const grouped = new Map<string, PayeTaxBand[]>();

  for (const band of bands) {
    const dateKey = normalizeEffectiveDateKey(band.effective_date);
    const mapped: PayeTaxBand = {
      band_order: band.band_order,
      band_from: band.band_from,
      band_to: band.band_to,
      rate: band.rate,
    };
    const group = grouped.get(dateKey) ?? [];
    group.push(mapped);
    grouped.set(dateKey, group);
  }

  const datedKeys = [...grouped.keys()].filter(Boolean);
  const eligibleKeys = datedKeys.filter((date) => date <= asOfDate);

  let selectedKey: string | undefined;
  if (eligibleKeys.length > 0) {
    selectedKey = eligibleKeys.sort((left, right) => right.localeCompare(left))[0];
  } else if (grouped.has("")) {
    selectedKey = "";
  } else if (datedKeys.length > 0) {
    selectedKey = datedKeys.sort((left, right) => right.localeCompare(left))[0];
  }

  if (selectedKey === undefined) {
    return bands
      .map((band) => ({
        band_order: band.band_order,
        band_from: band.band_from,
        band_to: band.band_to,
        rate: band.rate,
      }))
      .sort((left, right) => {
        if (left.band_order != null && right.band_order != null) {
          return left.band_order - right.band_order;
        }

        return left.band_from - right.band_from;
      });
  }

  return [...(grouped.get(selectedKey) ?? [])].sort((left, right) => {
    if (left.band_order != null && right.band_order != null) {
      return left.band_order - right.band_order;
    }

    return left.band_from - right.band_from;
  });
}

export function mapSsnitConfigRows(
  rows: Record<string, unknown>[] | null | undefined,
): PayrollSsnitConfig[] {
  return (rows ?? []).map((row) => ({
    effective_date: String(row.effective_date ?? ""),
    employee_rate: Number(row.employee_rate) || 0,
    employer_tier1_rate: Number(row.employer_tier1_rate) || 0,
    employer_tier2_rate: Number(row.employer_tier2_rate) || 0,
    insurable_earnings_ceiling: Number(row.insurable_earnings_ceiling) || 0,
  }));
}

export function mapCasualTaxConfigRows(
  rows: Record<string, unknown>[] | null | undefined,
): PayrollCasualTaxConfig[] {
  return (rows ?? []).map((row) => ({
    effective_date: String(row.effective_date ?? ""),
    flat_rate: Number(row.flat_rate ?? row.rate ?? row.tax_rate) || 0,
  }));
}

export function mapPayrollPayeBandRows(
  rows: Record<string, unknown>[] | null | undefined,
): PayrollPayeBand[] {
  return (rows ?? []).map((row) => ({
    effective_date: String(row.effective_date ?? ""),
    ...mapPayeBandFromRecord(row),
  }));
}

export function buildManualInputsFromRow(
  row: Pick<
    PayrollProcessingRow,
    | "days_to_pay"
    | "bonuses"
    | "arrears"
    | "salary_advance"
    | "welfare_deduction"
    | "other_deductions"
  >,
  defaultDaysToPay: number,
): PayrollManualInputs {
  return {
    days_to_pay:
      row.days_to_pay === null || row.days_to_pay === undefined
        ? defaultDaysToPay
        : Number(row.days_to_pay) || 0,
    bonuses: Number(row.bonuses) || 0,
    arrears: Number(row.arrears) || 0,
    salary_advance: Number(row.salary_advance) || 0,
    welfare_deduction: Number(row.welfare_deduction) || 0,
    other_deductions: Number(row.other_deductions) || 0,
  };
}

export function countAbsencesForStaff(
  attendanceRows: PayrollAttendanceSource[],
  staffId: string,
  year: number,
  month: number,
): number {
  return attendanceRows.filter(
    (row) =>
      row.staff_id === staffId &&
      row.attendance_status === "Absent" &&
      isDateInPayrollMonth(row.date, year, month),
  ).length;
}

export function sumOvertimeForEmployee(
  overtimeRows: PayrollOvertimeSource[],
  employeeId: string,
  year: number,
  month: number,
): number {
  return overtimeRows
    .filter(
      (row) =>
        row.employee_id === employeeId &&
        isDateInPayrollMonth(row.date, year, month),
    )
    .reduce((sum, row) => sum + (Number(row.overtime_amount) || 0), 0);
}

export function calculateLoanRepaymentForEmployee(
  loans: LoanRegisterEntry[],
  employeeId: string,
): number {
  return loans
    .filter((loan) => {
      if (loan.employee_id !== employeeId) {
        return false;
      }

      const status = (loan as LoanRegisterEntry & { status?: string | null })
        .status;
      if (status) {
        return status === "Active";
      }

      const outstanding =
        loan.outstanding_balance ??
        calculateLoanOutstanding(
          loan.loan_amount,
          loan.total_repaid_to_date ?? 0,
        );
      return outstanding > 0.01;
    })
    .reduce((sum, loan) => {
      const outstanding =
        loan.outstanding_balance ??
        calculateLoanOutstanding(
          loan.loan_amount,
          loan.total_repaid_to_date ?? 0,
        );

      if (outstanding <= 0.01) {
        return sum;
      }

      return sum + Math.min(Number(loan.monthly_deduction) || 0, outstanding);
    }, 0);
}

export function calculatePayrollRow(
  employee: PayrollEmployeeSource,
  period: SelectedPayrollPeriod,
  taxConfigs: PayrollTaxConfigs,
  sources: {
    absenceCount: number;
    overtimeAmount: number;
    loanRepayment: number;
  },
  manual: Partial<PayrollManualInputs> = {},
): PayrollCalculatedRow {
  const basicSalary = Number(employee.basic_salary) || 0;
  const housingAllowance = Number(employee.housing_allowance) || 0;
  const transportAllowance = Number(employee.transport_allowance) || 0;
  const otherAllowances = Number(employee.other_allowances) || 0;
  const totalWorkingDays = period.totalWorkingDays;
  const dailyRate =
    totalWorkingDays > 0 ? basicSalary / totalWorkingDays : 0;
  const daysToPay =
    manual.days_to_pay ??
    (totalWorkingDays > 0 ? totalWorkingDays : 0);
  const periodPayBasic = dailyRate * daysToPay;
  const absenceDeduction = dailyRate * sources.absenceCount;
  const overtimeAmount = sources.overtimeAmount;
  const loanRepayment = sources.loanRepayment;
  const bonuses = Number(manual.bonuses) || 0;
  const arrears = Number(manual.arrears) || 0;
  const salaryAdvance = Number(manual.salary_advance) || 0;
  const welfareDeduction = Number(manual.welfare_deduction) || 0;
  const otherDeductions = Number(manual.other_deductions) || 0;

  const grossPay = roundMoney(
    periodPayBasic +
      housingAllowance +
      transportAllowance +
      otherAllowances +
      overtimeAmount +
      bonuses +
      arrears,
  );

  const asOf = getPeriodEndDate(period.year, period.month);
  const employmentType = employee.employment_type?.trim() ?? "";

  let employeeSsnit = 0;
  let employerSsnit = 0;
  let tier2 = 0;
  let payeTax = 0;

  if (employmentType === "Casual") {
    const casualConfig = pickLatestByEffectiveDate(taxConfigs.casualRows, asOf);
    payeTax = roundMoney(
      basicSalary * normalizeRate(Number(casualConfig?.flat_rate) || 0),
    );
  } else if (
    employmentType === "Full-Time" ||
    employmentType === "Part-Time"
  ) {
    const ssnitConfig = pickLatestByEffectiveDate(taxConfigs.ssnitRows, asOf);
    const insurableBase = Math.min(
      basicSalary,
      Number(ssnitConfig?.insurable_earnings_ceiling) || basicSalary,
    );

    employeeSsnit = roundMoney(
      insurableBase * normalizeRate(Number(ssnitConfig?.employee_rate) || 0),
    );
    employerSsnit = roundMoney(
      insurableBase *
        normalizeRate(Number(ssnitConfig?.employer_tier1_rate) || 0),
    );
    tier2 = roundMoney(
      insurableBase *
        normalizeRate(Number(ssnitConfig?.employer_tier2_rate) || 0),
    );

    const taxableIncome = Math.max(grossPay - employeeSsnit, 0);
    const payeBands = pickPayeBandsForDate(taxConfigs.payeBands, asOf);
    payeTax = calculatePayeTax(taxableIncome, payeBands);
  }

  const totalDeductions = roundMoney(
    employeeSsnit +
      payeTax +
      loanRepayment +
      salaryAdvance +
      welfareDeduction +
      otherDeductions +
      absenceDeduction,
  );

  const netPay = roundMoney(Math.max(grossPay - totalDeductions, 0));

  return {
    basic_salary: basicSalary,
    housing_allowance: housingAllowance,
    transport_allowance: transportAllowance,
    other_allowances: otherAllowances,
    daily_rate: roundMoney(dailyRate),
    days_to_pay: daysToPay,
    absence_deduction: roundMoney(absenceDeduction),
    overtime_amount: roundMoney(overtimeAmount),
    loan_repayment: roundMoney(loanRepayment),
    bonuses,
    arrears,
    salary_advance: salaryAdvance,
    welfare_deduction: welfareDeduction,
    other_deductions: otherDeductions,
    gross_pay: grossPay,
    employee_ssnit: employeeSsnit,
    employer_ssnit: employerSsnit,
    tier2,
    paye_tax: payeTax,
    total_deductions: totalDeductions,
    net_pay: netPay,
  };
}

export function buildProcessingPayload(
  payrollMonth: string,
  employee: PayrollEmployeeSource,
  calculated: PayrollCalculatedRow,
): Omit<PayrollProcessingRow, "id"> {
  return {
    payroll_month: payrollMonth,
    status: "Open",
    employee_id: employee.employee_id,
    basic_salary: calculated.basic_salary,
    housing_allowance: calculated.housing_allowance,
    transport_allowance: calculated.transport_allowance,
    other_allowances: calculated.other_allowances,
    department: employee.department,
    project_contract: employee.contract_project,
    daily_rate: calculated.daily_rate,
    days_to_pay: calculated.days_to_pay,
    absence_deduction: calculated.absence_deduction,
    overtime_amount: calculated.overtime_amount,
    loan_repayment: calculated.loan_repayment,
    bonuses: calculated.bonuses,
    arrears: calculated.arrears,
    salary_advance: calculated.salary_advance,
    welfare_deduction: calculated.welfare_deduction,
    other_deductions: calculated.other_deductions,
    gross_pay: calculated.gross_pay,
    employee_ssnit: calculated.employee_ssnit,
    employer_ssnit: calculated.employer_ssnit,
    tier2: calculated.tier2,
    paye_tax: calculated.paye_tax,
    total_deductions: calculated.total_deductions,
    net_pay: calculated.net_pay,
  };
}
