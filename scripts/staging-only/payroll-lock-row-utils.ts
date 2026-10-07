/**
 * Mirror payroll UI: salary_advance column from register (outstanding for month).
 */
import {
  sumSalaryAdvancesForEmployeeInMonth,
  type SalaryAdvanceRegisterEntry,
} from "../../app/dashboard/hr-payroll/salary-advance-register-utils";
import { calculatePayrollDeductionSavingsTotal } from "../../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import type { PayrollProcessingRow } from "../../app/dashboard/hr-payroll/payroll-processing-utils";

export function applyRegisterSalaryAdvancesToLockRows(
  rows: PayrollProcessingRow[],
  advances: SalaryAdvanceRegisterEntry[],
  payrollMonth: string,
  businessUnitId: string | null,
): PayrollProcessingRow[] {
  return rows.map((row) => {
    const registerSum = sumSalaryAdvancesForEmployeeInMonth(
      advances,
      row.employee_id,
      payrollMonth,
      businessUnitId,
    );
    const priorAdvance = Number(row.salary_advance) || 0;
    const salaryAdvance = registerSum > 0 ? registerSum : priorAdvance;
    if (salaryAdvance === priorAdvance) {
      return row;
    }
    const gross = Number(row.gross_pay) || 0;
    const totalDed =
      (Number(row.total_deductions) || 0) - priorAdvance + salaryAdvance;
    const netOnly = Number(row.net_only_adjustment) || 0;
    const netPay = Math.max(0, gross - totalDed) + netOnly;
    return {
      ...row,
      salary_advance: salaryAdvance,
      total_deductions: Math.round(totalDed * 100) / 100,
      net_pay: Math.round(netPay * 100) / 100,
    };
  });
}

export function expectedDedsavAmount(
  rows: PayrollProcessingRow[],
  advances: SalaryAdvanceRegisterEntry[],
  payrollMonth: string,
  businessUnitId: string | null,
): number {
  return calculatePayrollDeductionSavingsTotal(rows, {
    registerAdvances: advances,
    payrollMonth,
    businessUnitId,
  });
}
