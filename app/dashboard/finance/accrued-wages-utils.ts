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
  /** Prior-period net top-up included in net_pay; settles Accrued Wages when locked. */
  net_only_adjustment?: number | null;
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
  /** Optional; may carry cash_paid=<amount> and wages_forfeited=<amount>. */
  notes?: string | null;
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

/** Parse `cash_paid=7025.57` (or `cash_paid: 7025.57`) from expense notes. */
export function parseCashPaidFromExpenseNotes(
  notes: string | null | undefined,
): number | null {
  if (!notes) return null;
  const match = /cash_paid\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(notes);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? roundCurrency(value) : null;
}

/**
 * Parse `wages_forfeited=88.09` from expense notes.
 * Portion of unpaid net written off (e.g. inactive staff) — reduces Accrued Wages.
 */
export function parseWagesForfeitedFromExpenseNotes(
  notes: string | null | undefined,
): number {
  if (!notes) return 0;
  const match = /wages_forfeited\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/i.exec(notes);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? roundCurrency(value) : 0;
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
  // Non-Cash inventory moves (COGS / VOID-COGS / Internal Consumption) must
  // never hit cash — even if a row was incorrectly stored as Paid.
  if (normalizeStatus(entry.payment_status) === "non-cash") {
    return false;
  }
  if (/^(VOID-)?COGS-/i.test(normalizeText(entry.receipt_no))) {
    return false;
  }
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

/**
 * Paid PAYROLL-SAL with cash_paid &lt; month net leaves unpaid wages payable.
 * (Fully paid rows without a shortfall are not accrued.)
 */
export function isPartiallyPaidStaffSalariesExpense(
  entry: StaffSalariesExpenseEntry,
  monthNetPay: number,
): boolean {
  if (!isStaffSalariesExpenseEntry(entry)) {
    return false;
  }
  if (!isPaidStatus(entry.payment_status)) {
    return false;
  }
  if (
    !isPayrollAutoPostedExpense(entry) &&
    !parsePayrollMonthFromReceiptNo(entry.receipt_no)
  ) {
    return false;
  }

  const cashPaid = parseCashPaidFromExpenseNotes(entry.notes);
  if (cashPaid === null) {
    return false;
  }

  const forfeited = parseWagesForfeitedFromExpenseNotes(entry.notes);
  const shortfall = roundCurrency(monthNetPay - cashPaid - forfeited);
  return shortfall > 0.005;
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

export function sumNetOnlyAdjustmentByPayrollMonth(
  entries: PayrollHistoryWagesEntry[],
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const payrollMonth = normalizePayrollMonthKey(entry.payroll_month);
    totals.set(
      payrollMonth,
      roundCurrency(
        (totals.get(payrollMonth) ?? 0) +
          (Number(entry.net_only_adjustment) || 0),
      ),
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
      net_only_adjustment: entry.net_only_adjustment ?? 0,
    });
  }

  return merged;
}

/**
 * Accrued Wages Payable:
 * 1. Fully unpaid Accrued PAYROLL-SAL months → full month net_pay
 * 2. Paid PAYROLL-SAL with cash_paid &lt; net → shortfall (net − cash_paid − wages_forfeited)
 * 3. net_only_adjustment on later locked/recognized payroll months settles (2)
 *    without re-expensing (Staff Salaries on lock = gross only)
 */
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
  const netOnlyByMonth = sumNetOnlyAdjustmentByPayrollMonth(payrollHistory);

  // One expense row per payroll month (prefer auto PAYROLL-SAL receipt).
  const expenseByPayrollMonth = new Map<string, StaffSalariesExpenseEntry>();
  for (const expense of staffSalariesExpenses) {
    if (!isStaffSalariesExpenseEntry(expense)) {
      continue;
    }

    const payrollMonth = resolveStaffSalariesPayrollMonth(expense);
    const existing = expenseByPayrollMonth.get(payrollMonth);
    if (!existing) {
      expenseByPayrollMonth.set(payrollMonth, expense);
      continue;
    }
    // Prefer the auto PAYROLL-SAL receipt row when duplicates exist.
    if (
      parsePayrollMonthFromReceiptNo(expense.receipt_no) &&
      !parsePayrollMonthFromReceiptNo(existing.receipt_no)
    ) {
      expenseByPayrollMonth.set(payrollMonth, expense);
    }
  }

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let openAccrualNets = 0;
    let partialShortfalls = 0;
    let recognizedNetOnly = 0;
    const countedPayrollMonths = new Set<string>();

    for (const [payrollMonth, expense] of expenseByPayrollMonth) {
      const expenseDate = normalizeDate(expense.date);
      if (!expenseDate || expenseDate > monthEnd) {
        continue;
      }

      if (countedPayrollMonths.has(payrollMonth)) {
        continue;
      }
      countedPayrollMonths.add(payrollMonth);

      const monthNet = roundCurrency(
        netPayByMonth.get(payrollMonth) ??
          resolveNetPayForPayrollMonth(
            payrollMonth,
            payrollHistory,
            monthEndCloseRecords,
          ),
      );
      const monthNetOnly = roundCurrency(netOnlyByMonth.get(payrollMonth) ?? 0);

      // Any recognized (posted) payroll month's net_only settles prior shortfalls.
      recognizedNetOnly = roundCurrency(recognizedNetOnly + monthNetOnly);

      if (isAccruedStaffSalariesExpense(expense)) {
        openAccrualNets = roundCurrency(openAccrualNets + monthNet);
        continue;
      }

      if (isPaidStatus(expense.payment_status)) {
        const cashPaid = parseCashPaidFromExpenseNotes(expense.notes);
        if (cashPaid === null) {
          continue;
        }
        const forfeited = parseWagesForfeitedFromExpenseNotes(expense.notes);
        const shortfall = roundCurrency(monthNet - cashPaid - forfeited);
        if (shortfall > 0) {
          partialShortfalls = roundCurrency(partialShortfalls + shortfall);
        }
      }
    }

    const unsettledShortfalls = roundCurrency(
      Math.max(0, partialShortfalls - recognizedNetOnly),
    );
    totals[month - 1] = roundCurrency(openAccrualNets + unsettledShortfalls);
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
