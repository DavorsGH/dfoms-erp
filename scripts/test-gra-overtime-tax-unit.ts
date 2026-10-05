/**
 * GRA overtime tax unit tests (David-approved rule, effective 2026-10-01).
 * Usage: npx tsx scripts/test-gra-overtime-tax-unit.ts
 */
import { calculatePayeTax } from "../app/dashboard/employees/pay-estimate-utils";
import {
  calculatePayrollRow,
  sumOvertimeForEmployeeInPeriod,
  type PayrollEmployeeSource,
  type PayrollOvertimeSource,
  type PayrollTaxConfigs,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { SelectedPayrollPeriod } from "../app/dashboard/hr-payroll/payroll-period-utils";
import { assert } from "./lib/env";

const GRA_OT_CONFIG = {
  effective_date: "2026-10-01",
  junior_annual_income_threshold: 18000,
  basic_salary_split_ratio: 0.5,
  rate_within_split: 0.05,
  rate_above_split: 0.1,
};

const PAYE_BANDS = [
  {
    effective_date: "2020-01-01",
    band_order: 1,
    band_from: 0,
    band_to: null as number | null,
    rate: 0.25,
  },
];

const SSNIT_ROWS = [
  {
    effective_date: "2020-01-01",
    employee_rate: 0.055,
    employer_tier1_rate: 0.08,
    employer_tier2_rate: 0.05,
    insurable_earnings_ceiling: 90000,
  },
];

const CASUAL_ROWS = [{ effective_date: "2020-01-01", flat_rate: 0.05 }];

function taxConfigs(): PayrollTaxConfigs {
  return {
    ssnitRows: SSNIT_ROWS,
    casualRows: CASUAL_ROWS,
    payeBands: PAYE_BANDS,
    overtimeRows: [GRA_OT_CONFIG],
  };
}

function period(year: number, month: number): SelectedPayrollPeriod {
  return {
    year,
    month,
    payrollMonth: `${year}-${String(month).padStart(2, "0")}-01`,
    totalWorkingDays: 22,
  };
}

function employee(
  overrides: Partial<PayrollEmployeeSource> & {
    employment_type: string;
  },
): PayrollEmployeeSource {
  return {
    employee_id: "emp-1",
    staff_id: "ST001",
    department: "Ops",
    contract_project: null,
    basic_salary: 590,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
    welfare_deduction_rate: 0,
    ...overrides,
  };
}

function almostEqual(a: number, b: number, eps = 0.011): boolean {
  return Math.abs(a - b) <= eps;
}

function test1JuniorOvertimeFivePercent() {
  const p = period(2026, 10);
  const e = employee({
    employment_type: "Full-Time",
    housing_allowance: 340,
  });
  const calculated = calculatePayrollRow(
    e,
    p,
    taxConfigs(),
    { absenceCount: 0, overtimeAmount: 105.26, loanRepayment: 0 },
    { days_to_pay: 22 },
    null,
  );

  assert(almostEqual(calculated.overtime_tax, 5.26), "test1 overtime tax");
  assert(calculated.overtime_tax > 0, "test1 overtime tax line");

  const grossWithOt = 930 + 105.26;
  const payeIfOtInPaye = calculatePayeTax(
    grossWithOt - calculated.employee_ssnit,
    PAYE_BANDS,
  );
  assert(
    almostEqual(calculated.paye_tax, calculatePayeTax(930 - calculated.employee_ssnit, PAYE_BANDS)),
    "test1 PAYE on regular emoluments only",
  );
  assert(
    calculated.paye_tax < payeIfOtInPaye - 0.01,
    "test1 PAYE lower than if overtime were in PAYE base",
  );
}

function test2JuniorSplitRates() {
  const p = period(2026, 10);
  const e = employee({
    employment_type: "Full-Time",
    housing_allowance: 340,
  });
  const calculated = calculatePayrollRow(
    e,
    p,
    taxConfigs(),
    { absenceCount: 0, overtimeAmount: 400, loanRepayment: 0 },
    { days_to_pay: 22 },
    null,
  );
  assert(almostEqual(calculated.overtime_tax, 25.25), "test2 overtime tax split");
}

function test3SeniorNoOvertimeTax() {
  const p = period(2026, 10);
  const e = employee({
    employment_type: "Full-Time",
    basic_salary: 2500,
    housing_allowance: 500,
  });
  const calculated = calculatePayrollRow(
    e,
    p,
    taxConfigs(),
    { absenceCount: 0, overtimeAmount: 105.26, loanRepayment: 0 },
    { days_to_pay: 22 },
    {
      basic_salary: 2500,
      housing_allowance: 500,
      transport_allowance: 0,
      other_allowances: 0,
      allowance_lines: [],
    },
  );
  assert(calculated.overtime_tax === 0, "test3 no overtime tax");
  const taxable = calculated.gross_pay - calculated.employee_ssnit;
  assert(
    almostEqual(calculated.paye_tax, calculatePayeTax(taxable, PAYE_BANDS)),
    "test3 PAYE includes overtime in base",
  );
}

function test4CasualOvertimeFlat() {
  const p = period(2026, 10);
  const e = employee({ employment_type: "Casual", basic_salary: 400 });
  const calculated = calculatePayrollRow(
    e,
    p,
    taxConfigs(),
    { absenceCount: 0, overtimeAmount: 105.26, loanRepayment: 0 },
    { days_to_pay: 22 },
  );
  assert(almostEqual(calculated.overtime_tax, 5.26), "test4 casual OT tax");
  const basicOnlyCasual = 400 * 0.05;
  assert(
    almostEqual(calculated.paye_tax, basicOnlyCasual),
    "test4 casual PAYE on basic unchanged",
  );
}

function test5UnapprovedOvertimeExcluded() {
  const p = period(2026, 10);
  const rows: PayrollOvertimeSource[] = [
    {
      employee_id: "emp-1",
      date: "2026-10-15",
      overtime_amount: 200,
      approved_by: null,
    },
    {
      employee_id: "emp-1",
      date: "2026-10-16",
      overtime_amount: 50,
      approved_by: "David",
    },
  ];
  const sum = sumOvertimeForEmployeeInPeriod(rows, "emp-1", p);
  assert(sum === 50, "test5 only approved overtime counted");
}

function test6PreEffectiveLegacyBehaviour() {
  const p = period(2026, 9);
  const e = employee({ employment_type: "Full-Time" });
  const rows: PayrollOvertimeSource[] = [
    {
      employee_id: "emp-1",
      date: "2026-09-10",
      overtime_amount: 105.26,
      approved_by: null,
    },
  ];
  const overtimeAmount = sumOvertimeForEmployeeInPeriod(rows, "emp-1", p);
  assert(almostEqual(overtimeAmount, 105.26), "test6 unapproved OT still included pre-Oct");

  const eSep = employee({
    employment_type: "Full-Time",
    housing_allowance: 340,
  });
  const calculated = calculatePayrollRow(
    eSep,
    p,
    taxConfigs(),
    { absenceCount: 0, overtimeAmount, loanRepayment: 0 },
    { days_to_pay: 22 },
    null,
  );
  assert(calculated.overtime_tax === 0, "test6 no separate overtime tax");
  const taxable = calculated.gross_pay - calculated.employee_ssnit;
  assert(
    almostEqual(calculated.paye_tax, calculatePayeTax(taxable, PAYE_BANDS)),
    "test6 PAYE on full gross incl. OT",
  );
}

function main() {
  test1JuniorOvertimeFivePercent();
  test2JuniorSplitRates();
  test3SeniorNoOvertimeTax();
  test4CasualOvertimeFlat();
  test5UnapprovedOvertimeExcluded();
  test6PreEffectiveLegacyBehaviour();
  console.log("OK: GRA overtime tax unit tests passed (6 cases)");
}

main();
