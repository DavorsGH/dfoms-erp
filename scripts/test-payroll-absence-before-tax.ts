/**
 * Unpaid absence reduces gross before SSNIT and PAYE from October 2026.
 * Usage: npx tsx scripts/test-payroll-absence-before-tax.ts
 */
import assert from "node:assert/strict";
import { calculatePayeTax } from "../app/dashboard/employees/pay-estimate-utils";
import { calculatePayrollDeductionSavingsTotal } from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  calculatePayrollRow,
  type PayrollEmployeeSource,
  type PayrollTaxConfigs,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { SelectedPayrollPeriod } from "../app/dashboard/hr-payroll/payroll-period-utils";

const PAYE_BANDS = [
  { effective_date: "2020-01-01", band_order: 1, band_from: 0, band_to: 490, rate: 0 },
  { effective_date: "2020-01-01", band_order: 2, band_from: 490, band_to: 600, rate: 0.05 },
  { effective_date: "2020-01-01", band_order: 3, band_from: 600, band_to: 730, rate: 0.1 },
  {
    effective_date: "2020-01-01",
    band_order: 4,
    band_from: 730,
    band_to: 3896.33,
    rate: 0.175,
  },
  {
    effective_date: "2020-01-01",
    band_order: 5,
    band_from: 3896.33,
    band_to: null,
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

const tax: PayrollTaxConfigs = {
  ssnitRows: SSNIT_ROWS,
  casualRows: [{ effective_date: "2020-01-01", flat_rate: 0.05 }],
  payeBands: PAYE_BANDS,
  overtimeRows: [],
};

function period(year: number, month: number, days: number): SelectedPayrollPeriod {
  return {
    year,
    month,
    payrollMonth: `${year}-${String(month).padStart(2, "0")}-01`,
    totalWorkingDays: days,
  };
}

function employee(
  overrides: Partial<PayrollEmployeeSource> & { employment_type: string },
): PayrollEmployeeSource {
  return {
    employee_id: "emp-1",
    staff_id: "DF0020",
    full_name: "Patience Ashie",
    employment_status: "Active",
    date_hired: "2020-01-01",
    appointment_end_date: null,
    position: "Cleaner",
    shift: "Morning",
    basic_salary: 589.47,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
    department: null,
    contract_project: null,
    welfare_deduction_rate: 5,
    ...overrides,
  };
}

function testPatienceOctober() {
  const row = calculatePayrollRow(
    employee({ employment_type: "Casual" }),
    period(2026, 10, 27),
    tax,
    { absenceCount: 0.5, overtimeAmount: 0, loanRepayment: 0 },
    { days_to_pay: 27 },
  );
  assert.equal(row.absence_deduction, 10.92);
  assert.equal(row.gross_pay, 578.55);
  assert.equal(row.employee_ssnit, 0);
  assert.equal(row.paye_tax, 28.93);
  assert.equal(row.welfare_deduction, 28.93);
  assert.equal(row.total_deductions, 57.86);
  assert.equal(row.net_pay, 520.69);
}

function testFullTimeAbsentDay() {
  const row = calculatePayrollRow(
    employee({
      employment_type: "Full-Time",
      staff_id: "DF0100",
      full_name: "Ama Mensah",
      basic_salary: 3000,
      housing_allowance: 500,
      welfare_deduction_rate: 0,
    }),
    period(2026, 10, 20),
    tax,
    { absenceCount: 1, overtimeAmount: 0, loanRepayment: 0 },
    { days_to_pay: 20 },
  );
  assert.equal(row.daily_rate, 150);
  assert.equal(row.absence_deduction, 150);
  assert.equal(row.gross_pay, 3350);
  assert.equal(row.employee_ssnit, 156.75);
  assert.equal(row.employer_ssnit, 228);
  assert.equal(row.tier2, 142.5);
  const paye = calculatePayeTax(3350 - 156.75, PAYE_BANDS);
  assert.equal(row.paye_tax, paye);
  assert.ok(row.paye_tax < calculatePayeTax(3500 - 165, PAYE_BANDS));
  assert.equal(row.welfare_deduction, 0);
  assert.equal(row.total_deductions, Math.round((156.75 + paye) * 100) / 100);
  assert.equal(
    row.net_pay,
    Math.round((3350 - row.total_deductions) * 100) / 100,
  );
  assert.equal(row.total_deductions < 156.75 + paye + 150, true);
}

function testNoAbsenceUnchanged() {
  const person = employee({
    employment_type: "Full-Time",
    staff_id: "DF0101",
    full_name: "Kwame Boateng",
    basic_salary: 2200,
    housing_allowance: 200,
    welfare_deduction_rate: 2.5,
  });
  const manuals = {
    days_to_pay: 22,
    bonuses: 40,
    arrears: 15,
    salary_advance: 25,
    other_deductions: 8,
    net_only_adjustment: 3,
  };
  const sources = { absenceCount: 0, overtimeAmount: 0, loanRepayment: 10 };
  const october = calculatePayrollRow(
    person,
    period(2026, 10, 22),
    tax,
    sources,
    manuals,
  );
  const september = calculatePayrollRow(
    person,
    period(2026, 9, 22),
    tax,
    sources,
    manuals,
  );
  for (const field of [
    "gross_pay",
    "employee_ssnit",
    "employer_ssnit",
    "tier2",
    "paye_tax",
    "welfare_deduction",
    "total_deductions",
    "net_pay",
    "absence_deduction",
  ] as const) {
    assert.equal(october[field], september[field], field);
  }
  assert.equal(october.absence_deduction, 0);
  assert.equal(october.gross_pay, 2455);
  assert.ok(october.total_deductions >= 25 + 8 + 10);
}

function testLockedSeptemberUnchanged() {
  const row = calculatePayrollRow(
    employee({
      employment_type: "Full-Time",
      basic_salary: 3000,
      housing_allowance: 500,
      welfare_deduction_rate: 5,
    }),
    period(2026, 9, 20),
    tax,
    { absenceCount: 1, overtimeAmount: 0, loanRepayment: 0 },
    { days_to_pay: 20 },
  );
  assert.equal(row.absence_deduction, 150);
  assert.equal(row.gross_pay, 3500);
  assert.equal(row.employee_ssnit, 165);
  assert.equal(row.welfare_deduction, 175);
  const paye = calculatePayeTax(3500 - 165, PAYE_BANDS);
  assert.equal(row.paye_tax, paye);
  assert.equal(
    row.total_deductions,
    Math.round((165 + paye + 175 + 150) * 100) / 100,
  );
  assert.equal(
    row.net_pay,
    Math.round((3500 - row.total_deductions) * 100) / 100,
  );
}

function testWelfareOnEarnedGrossFromOctober() {
  const row = calculatePayrollRow(
    employee({ employment_type: "Casual", welfare_deduction_rate: 5 }),
    period(2026, 10, 27),
    tax,
    { absenceCount: 0.5, overtimeAmount: 0, loanRepayment: 0 },
    { days_to_pay: 27, bonuses: 20 },
  );
  assert.equal(row.gross_pay, 598.55);
  assert.equal(row.welfare_deduction, 29.93);
  assert.equal(row.paye_tax, 28.93);
}

function testDeductionSavingsGate() {
  const rows = [
    {
      employee_id: "emp-1",
      absence_deduction: 10.92,
      loan_repayment: 5,
      other_deductions: 2,
      salary_advance: 0,
    },
  ];
  assert.equal(
    calculatePayrollDeductionSavingsTotal(rows, { payrollMonth: "2026-09-01" }),
    17.92,
  );
  assert.equal(
    calculatePayrollDeductionSavingsTotal(rows, { payrollMonth: "2026-10-01" }),
    7,
  );
  assert.equal(calculatePayrollDeductionSavingsTotal(rows), 17.92);
}

testPatienceOctober();
testFullTimeAbsentDay();
testNoAbsenceUnchanged();
testLockedSeptemberUnchanged();
testWelfareOnEarnedGrossFromOctober();
testDeductionSavingsGate();
console.log("OK: payroll absence-before-tax tests passed");
