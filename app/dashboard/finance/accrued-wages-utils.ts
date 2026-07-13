import {
  PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX,
  PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
} from "../hr-payroll/payroll-lock-finance-utils";
import {
  getPeriodStartDate,
  parsePeriodKey,
} from "../hr-payroll/payroll-period-utils";
import { getMonthEndDate } from "./capital-contributions-utils";
import type { CashFlowExpenseEntry } from "./cash-flow-utils";
import { normalizeCategoryName } from "./profit-loss-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  type MonthlyTotals,
} from "./profit-loss-utils";

export const STAFF_SALARIES_ACCRUED_STATUS = PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED;

export type PayrollHistoryWagesEntry = {
  payroll_month: string;
  net_pay: number;
};

export type MonthEndCloseNetPayEntry = {
  month: string;
  total_net_pay: number | null;
};

export type StaffSalariesExpenseEntry = {
  date: string;
  expense_category: string;
  sub_category: string;
  amount: number;
  payment_status: string;
  description?: string | null;
  receipt_no?: string | null;
};

export type BalanceSheetCashExpenseEntry = StaffSalariesExpenseEntry;

const MONTH_NAME_TO_NUMBER: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeStatus(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-");
}

export function isPayrollAutoPostedExpense(
  entry: Pick<StaffSalariesExpenseEntry, "description" | "receipt_no">,
): boolean {
  const description = normalizeText(entry.description);
  if (
    description
      .toLowerCase()
      .startsWith(PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX.toLowerCase())
  ) {
    return true;
  }

  return /^PAYROLL-(SAL|ESSNIT)-/i.test(normalizeText(entry.receipt_no));
}

export function isPaidStatus(paymentStatus: string | null | undefined): boolean {
  const normalized = normalizeStatus(paymentStatus);
  return normalized === "paid";
}

export function isAccruedPaymentStatus(
  paymentStatus: string | null | undefined,
): boolean {
  const normalized = normalizeStatus(paymentStatus);
  if (!normalized) {
    return false;
  }

  if (normalized === "paid" || normalized === "partial") {
    return false;
  }

  if (normalized.includes("accrued")) {
    return true;
  }

  if (normalized.includes("not yet paid")) {
    return true;
  }

  return normalized === STAFF_SALARIES_ACCRUED_STATUS.toLowerCase();
}

export function isCashOutflowExpense(entry: BalanceSheetCashExpenseEntry): boolean {
  return isPaidStatus(entry.payment_status);
}

export function isStaffSalariesExpenseEntry(
  entry: StaffSalariesExpenseEntry,
): boolean {
  if (/PAYROLL-ESSNIT-/i.test(normalizeText(entry.receipt_no))) {
    return false;
  }

  if (
    normalizeCategoryName(entry.expense_category) ===
    normalizeCategoryName(PAYROLL_EXPENSE_CATEGORY_STAFF_SALARIES)
  ) {
    return true;
  }

  if (parsePayrollMonthFromReceiptNo(entry.receipt_no)) {
    return true;
  }

  const category = normalizeCategoryName(entry.expense_category);
  if (
    isPayrollAutoPostedExpense(entry) &&
    category.includes("staff") &&
    category.includes("salaries")
  ) {
    return true;
  }

  return false;
}

export function normalizePayrollMonthKey(value: string): string {
  const datePart = normalizeDate(value);
  const match = /^(\d{4})-(\d{2})/.exec(datePart);
  if (!match) {
    return datePart;
  }

  return getPeriodStartDate(Number(match[1]), Number(match[2]));
}

export function parsePayrollMonthFromAutoPostDescription(
  description: string | null | undefined,
): string | null {
  if (!description) {
    return null;
  }

  const trimmed = description.trim();
  const prefix = `${PAYROLL_EXPENSE_AUTO_DESCRIPTION_PREFIX} `;
  if (!trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return null;
  }

  const remainder = trimmed.slice(prefix.length).trim();
  const match = /^([A-Za-z]+)\s+(\d{4})$/.exec(remainder);
  if (!match) {
    return null;
  }

  const monthNumber = MONTH_NAME_TO_NUMBER[match[1].trim().toLowerCase()];
  const year = Number.parseInt(match[2], 10);
  if (!monthNumber || !Number.isFinite(year)) {
    return null;
  }

  return getPeriodStartDate(year, monthNumber);
}

export function parsePayrollMonthFromReceiptNo(
  receiptNo: string | null | undefined,
): string | null {
  if (!receiptNo) {
    return null;
  }

  const match = /PAYROLL-SAL-(\d{4}-\d{2})/i.exec(receiptNo.trim());
  if (!match) {
    return null;
  }

  const parsed = parsePeriodKey(match[1]);
  if (!parsed) {
    return null;
  }

  return getPeriodStartDate(parsed.year, parsed.month);
}

export function isAccruedStaffSalariesExpense(
  entry: StaffSalariesExpenseEntry,
): boolean {
  if (!isStaffSalariesExpenseEntry(entry)) {
    return false;
  }

  if (isPayrollAutoPostedExpense(entry)) {
    return !isPaidStatus(entry.payment_status);
  }

  return isAccruedPaymentStatus(entry.payment_status);
}

export function expenseDateToPayrollMonth(date: string): string {
  const normalized = normalizeDate(date);
  const match = /^(\d{4})-(\d{2})/.exec(normalized);
  if (!match) {
    return normalized;
  }

  return getPeriodStartDate(Number(match[1]), Number(match[2]));
}

export function resolveStaffSalariesPayrollMonth(
  expense: StaffSalariesExpenseEntry,
): string {
  return normalizePayrollMonthKey(
    parsePayrollMonthFromAutoPostDescription(expense.description) ??
      parsePayrollMonthFromReceiptNo(expense.receipt_no) ??
      expenseDateToPayrollMonth(expense.date),
  );
}

export function sumNetPayByPayrollMonth(
  entries: PayrollHistoryWagesEntry[],
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const payrollMonth = normalizePayrollMonthKey(entry.payroll_month);
    totals.set(
      payrollMonth,
      roundCurrency((totals.get(payrollMonth) ?? 0) + (Number(entry.net_pay) || 0)),
    );
  }

  return totals;
}

export function resolveNetPayForPayrollMonth(
  payrollMonth: string,
  payrollHistory: PayrollHistoryWagesEntry[],
  monthEndCloseRecords: MonthEndCloseNetPayEntry[] = [],
): number {
  const normalizedMonth = normalizePayrollMonthKey(payrollMonth);
  const historyTotal = sumNetPayByPayrollMonth(payrollHistory).get(normalizedMonth) ?? 0;

  if (historyTotal > 0) {
    return historyTotal;
  }

  const closeRecord = monthEndCloseRecords.find(
    (record) => normalizePayrollMonthKey(record.month) === normalizedMonth,
  );

  return roundCurrency(Number(closeRecord?.total_net_pay) || 0);
}

export function buildNetPayByPayrollMonth(
  payrollHistory: PayrollHistoryWagesEntry[],
  monthEndCloseRecords: MonthEndCloseNetPayEntry[] = [],
): Map<string, number> {
  const totals = sumNetPayByPayrollMonth(payrollHistory);

  for (const record of monthEndCloseRecords) {
    const payrollMonth = normalizePayrollMonthKey(record.month);
    const closeTotal = roundCurrency(Number(record.total_net_pay) || 0);
    const historyTotal = totals.get(payrollMonth) ?? 0;

    if (closeTotal > historyTotal) {
      totals.set(payrollMonth, closeTotal);
    }
  }

  return totals;
}

export function mergePayrollWagesSources(
  payrollHistory: PayrollHistoryWagesEntry[],
  payrollProcessing: PayrollHistoryWagesEntry[] = [],
): PayrollHistoryWagesEntry[] {
  const historyMonths = new Set(
    payrollHistory.map((entry) => normalizePayrollMonthKey(entry.payroll_month)),
  );
  const merged = [...payrollHistory];

  for (const entry of payrollProcessing) {
    const payrollMonth = normalizePayrollMonthKey(entry.payroll_month);
    if (historyMonths.has(payrollMonth)) {
      continue;
    }

    merged.push({
      payroll_month: payrollMonth,
      net_pay: entry.net_pay,
    });
  }

  return merged;
}

export function calculateAccruedWagesPayableByMonth(
  payrollHistory: PayrollHistoryWagesEntry[],
  staffSalariesExpenses: StaffSalariesExpenseEntry[],
  financialYear: number,
  monthEndCloseRecords: MonthEndCloseNetPayEntry[] = [],
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  const netPayByMonth = buildNetPayByPayrollMonth(
    payrollHistory,
    monthEndCloseRecords,
  );

  const accruedExpensesByPayrollMonth = new Map<string, StaffSalariesExpenseEntry>();
  for (const expense of staffSalariesExpenses) {
    if (!isAccruedStaffSalariesExpense(expense)) {
      continue;
    }

    const payrollMonth = resolveStaffSalariesPayrollMonth(expense);
    if (!accruedExpensesByPayrollMonth.has(payrollMonth)) {
      accruedExpensesByPayrollMonth.set(payrollMonth, expense);
    }
  }

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let accruedWages = 0;
    const countedPayrollMonths = new Set<string>();

    for (const [payrollMonth] of accruedExpensesByPayrollMonth) {
      const expense = accruedExpensesByPayrollMonth.get(payrollMonth)!;
      const expenseDate = normalizeDate(expense.date);
      if (!expenseDate || expenseDate > monthEnd) {
        continue;
      }

      if (countedPayrollMonths.has(payrollMonth)) {
        continue;
      }

      countedPayrollMonths.add(payrollMonth);
      accruedWages += roundCurrency(
        netPayByMonth.get(payrollMonth) ??
          resolveNetPayForPayrollMonth(
            payrollMonth,
            payrollHistory,
            monthEndCloseRecords,
          ),
      );
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
  const netPayByMonth = buildNetPayByPayrollMonth(payrollHistory);
  const cashFlowExpenses: CashFlowExpenseEntry[] = [];

  for (const entry of expenseEntries) {
    if (isStaffSalariesExpenseEntry(entry)) {
      if (!isCashOutflowExpense(entry)) {
        continue;
      }

      const payrollMonth = resolveStaffSalariesPayrollMonth(entry);
      cashFlowExpenses.push({
        date: entry.date,
        sub_category: entry.sub_category,
        amount: netPayByMonth.get(payrollMonth) ?? 0,
        payment_status: entry.payment_status,
      });
      continue;
    }

    if (!isCashOutflowExpense(entry)) {
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
