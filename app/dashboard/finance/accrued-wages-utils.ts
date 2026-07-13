import {
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
} from "../hr-payroll/payroll-lock-finance-utils";
import { getMonthEndDate } from "./capital-contributions-utils";
import type { CashFlowExpenseEntry } from "./cash-flow-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  type MonthlyTotals,
} from "./profit-loss-utils";

export const STAFF_SALARIES_ACCRUED_STATUS = "Accrued - Not Yet Paid";

export type PayrollHistoryWagesEntry = {
  payroll_month: string;
  net_pay: number;
};

export type StaffSalariesExpenseEntry = {
  date: string;
  expense_category: string;
  sub_category: string;
  amount: number;
  payment_status: string;
  description?: string | null;
};

export type BalanceSheetCashExpenseEntry = StaffSalariesExpenseEntry;

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPaidStatus(paymentStatus: string): boolean {
  return paymentStatus.trim().toLowerCase() === "paid";
}

export function isAccruedStaffSalariesExpense(
  entry: StaffSalariesExpenseEntry,
): boolean {
  return (
    entry.expense_category === PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES &&
    entry.payment_status === STAFF_SALARIES_ACCRUED_STATUS
  );
}

export function expenseDateToPayrollMonth(date: string): string {
  const normalized = normalizeDate(date);
  return `${normalized.slice(0, 7)}-01`;
}

export function sumNetPayByPayrollMonth(
  entries: PayrollHistoryWagesEntry[],
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const payrollMonth = entry.payroll_month.slice(0, 10);
    totals.set(
      payrollMonth,
      roundCurrency((totals.get(payrollMonth) ?? 0) + (Number(entry.net_pay) || 0)),
    );
  }

  return totals;
}

export function calculateAccruedWagesPayableByMonth(
  payrollHistory: PayrollHistoryWagesEntry[],
  staffSalariesExpenses: StaffSalariesExpenseEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const netPayByMonth = sumNetPayByPayrollMonth(payrollHistory);

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let accruedWages = 0;

    for (const expense of staffSalariesExpenses) {
      if (!isAccruedStaffSalariesExpense(expense)) {
        continue;
      }

      const expenseDate = normalizeDate(expense.date);
      if (!expenseDate || expenseDate > monthEnd) {
        continue;
      }

      const payrollMonth = expenseDateToPayrollMonth(expense.date);
      accruedWages += netPayByMonth.get(payrollMonth) ?? 0;
    }

    totals[month - 1] = roundCurrency(accruedWages);
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

export function buildBalanceSheetCashFlowExpenses(
  expenseEntries: BalanceSheetCashExpenseEntry[],
  payrollHistory: PayrollHistoryWagesEntry[],
): CashFlowExpenseEntry[] {
  const netPayByMonth = sumNetPayByPayrollMonth(payrollHistory);
  const cashFlowExpenses: CashFlowExpenseEntry[] = [];

  for (const entry of expenseEntries) {
    if (entry.expense_category === PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES) {
      if (!isPaidStatus(entry.payment_status)) {
        continue;
      }

      const payrollMonth = expenseDateToPayrollMonth(entry.date);
      cashFlowExpenses.push({
        date: entry.date,
        sub_category: entry.sub_category,
        amount: netPayByMonth.get(payrollMonth) ?? 0,
        payment_status: entry.payment_status,
      });
      continue;
    }

    cashFlowExpenses.push({
      date: entry.date,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
    });
  }

  return cashFlowExpenses;
}
