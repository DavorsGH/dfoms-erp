/**
 * Welfare base excludes overtime when configured (Oct 2026+).
 * Usage: npx tsx scripts/test-welfare-overtime-base-unit.ts
 */
import {
  calculateWelfareDeductionForEmployee,
  calculatePayrollRow,
  type PayrollTaxConfigs,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { SelectedPayrollPeriod } from "../app/dashboard/hr-payroll/payroll-period-utils";
import { assert } from "./lib/env";

const EMPTY_TAX: PayrollTaxConfigs = {
  ssnitRows: [],
  casualRows: [],
  payeBands: [],
  overtimeRows: [],
};

function period(year: number, month: number): SelectedPayrollPeriod {
  return {
    year,
    month,
    payrollMonth: `${year}-${String(month).padStart(2, "0")}-01`,
    totalWorkingDays: 22,
  };
}

function almostEqual(a: number, b: number, eps = 0.011): boolean {
  return Math.abs(a - b) <= eps;
}

function testFullTimeOct2026() {
  const gross = 1217.41;
  const ot = 105.26;
  const rate = { welfare_deduction_rate: 5 };
  const asOf = "2026-10-31";

  const withOt = calculateWelfareDeductionForEmployee(rate, gross, {
    overtimeAmount: ot,
    asOfDate: asOf,
    includeOvertimeInWelfare: true,
  });
  const withoutOt = calculateWelfareDeductionForEmployee(rate, gross, {
    overtimeAmount: ot,
    asOfDate: asOf,
    includeOvertimeInWelfare: false,
  });

  assert(almostEqual(withOt, 60.87), "full-time TRUE welfare");
  assert(almostEqual(withoutOt, 55.61), "full-time FALSE welfare");
}

function testCasualOct2026() {
  const gross = 884.76;
  const ot = 105.26;
  const rate = { welfare_deduction_rate: 5 };
  const asOf = "2026-10-31";

  const withOt = calculateWelfareDeductionForEmployee(rate, gross, {
    overtimeAmount: ot,
    asOfDate: asOf,
    includeOvertimeInWelfare: true,
  });
  const withoutOt = calculateWelfareDeductionForEmployee(rate, gross, {
    overtimeAmount: ot,
    asOfDate: asOf,
    includeOvertimeInWelfare: false,
  });

  assert(almostEqual(withOt, 44.24), "casual TRUE welfare");
  assert(almostEqual(withoutOt, 38.98), "casual FALSE welfare");
}

function testPreEffectiveIgnoresSetting() {
  const gross = 1217.41;
  const ot = 105.26;
  const rate = { welfare_deduction_rate: 5 };
  const asOf = "2026-09-30";

  const legacy = calculateWelfareDeductionForEmployee(rate, gross, {
    overtimeAmount: ot,
    asOfDate: asOf,
    includeOvertimeInWelfare: false,
  });

  assert(almostEqual(legacy, 60.87), "Sep 2026 ignores exclude-OT setting");

  const row = calculatePayrollRow(
    {
      employee_id: "e1",
      staff_id: "S1",
      full_name: "Test",
      employment_type: "Full-Time",
      employment_status: "Active",
      date_hired: null,
      appointment_end_date: null,
      position: null,
      shift: null,
      basic_salary: 1000,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      department: null,
      contract_project: null,
      welfare_deduction_rate: 5,
    },
    period(2026, 9),
    EMPTY_TAX,
    { absenceCount: 0, overtimeAmount: ot, loanRepayment: 0 },
    {},
    null,
    { includeOvertimeInWelfare: false },
  );

  const expectedOnGross = calculateWelfareDeductionForEmployee(
    { welfare_deduction_rate: 5 },
    row.gross_pay,
    {
      overtimeAmount: ot,
      asOfDate: asOf,
      includeOvertimeInWelfare: false,
    },
  );
  assert(
    almostEqual(row.welfare_deduction, expectedOnGross),
    "calculatePayrollRow Sep 2026 ignores exclude-OT setting",
  );
}

function main() {
  testFullTimeOct2026();
  testCasualOct2026();
  testPreEffectiveIgnoresSetting();
  console.log("OK: welfare overtime base unit tests passed (3 cases)");
}

main();
