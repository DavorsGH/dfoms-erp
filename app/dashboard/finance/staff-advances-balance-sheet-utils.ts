import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "./profit-loss-utils";

export type StaffAdvanceBalanceSheetEntry = {
  date_issued: string;
  amount: number;
  status: "outstanding" | "deducted";
  deduct_payroll_month: string;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

function monthKeyFromDate(value: string): string {
  return value.slice(0, 7);
}

function isReceivableAtMonthEnd(
  entry: StaffAdvanceBalanceSheetEntry,
  monthEndDate: string,
): boolean {
  const issued = entry.date_issued.slice(0, 10);
  if (issued > monthEndDate) {
    return false;
  }
  if (entry.status === "outstanding") {
    return true;
  }
  const deductKey = monthKeyFromDate(
    normalizeMonthStart(entry.deduct_payroll_month),
  );
  const asKey = monthKeyFromDate(monthEndDate);
  return deductKey > asKey;
}

function normalizeMonthStart(value: string): string {
  const part = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})/.exec(part);
  if (!match) {
    return part;
  }
  return `${match[1]}-${match[2]}-01`;
}

function monthEndDateForIndex(financialYear: number, monthIndex: number): string {
  const month = monthIndex + 1;
  const lastDay = new Date(financialYear, month, 0).getDate();
  return `${financialYear}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function calculateStaffAdvancesReceivableByMonth(
  entries: StaffAdvanceBalanceSheetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthEnd = monthEndDateForIndex(financialYear, monthIndex);
    let sum = 0;
    for (const entry of entries) {
      if (!isReceivableAtMonthEnd(entry, monthEnd)) {
        continue;
      }
      sum = roundCurrency(sum + (Number(entry.amount) || 0));
    }
    totals[monthIndex] = sum;
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return roundMonthlyTotals(totals);
}

export function calculateStaffAdvanceCashOutflowsByMonth(
  entries: StaffAdvanceBalanceSheetEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const entry of entries) {
    const amount = Number(entry.amount) || 0;
    if (amount <= 0) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(entry.date_issued, financialYear);
    if (monthIndex === null) {
      continue;
    }
    totals[monthIndex] = roundCurrency(totals[monthIndex] + amount);
    totals[FULL_YEAR_INDEX] = roundCurrency(totals[FULL_YEAR_INDEX] + amount);
  }

  return roundMonthlyTotals(totals);
}
