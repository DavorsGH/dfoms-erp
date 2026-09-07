import { getMonthEndDate } from "./capital-contributions-utils";
import { createEmptyMonthlyTotals, FULL_YEAR_INDEX, type MonthlyTotals } from "./profit-loss-utils";

export const STAFF_WELFARE_DISBURSEMENT_CATEGORY = "Staff Welfare Disbursement";
export const STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE = "payroll_period" as const;
export const STAFF_WELFARE_FUND_CLAIM_SOURCE_TYPE = "claim" as const;
export const STAFF_WELFARE_FUND_MANUAL_SOURCE_TYPE = "manual" as const;

export const STAFF_WELFARE_LEDGER_SELECT =
  "id, tenant_id, business_unit_id, entry_date, period_month, entry_type, amount, status, source_type, source_id, employee_id, counterparty_name, notes, paid_at, expense_receipt_no, created_at, updated_at";

export type StaffWelfareFundEntryType = "accrual" | "disbursement" | "adjustment";
export type StaffWelfareFundLedgerStatus = "open" | "settled" | "reversed";
export type StaffWelfareFundSourceType =
  | typeof STAFF_WELFARE_FUND_PAYROLL_SOURCE_TYPE
  | typeof STAFF_WELFARE_FUND_CLAIM_SOURCE_TYPE
  | typeof STAFF_WELFARE_FUND_MANUAL_SOURCE_TYPE;

export type StaffWelfareFundLedgerEntry = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  entry_date: string;
  period_month: string | null;
  entry_type: StaffWelfareFundEntryType;
  amount: number;
  status: StaffWelfareFundLedgerStatus;
  source_type: StaffWelfareFundSourceType;
  source_id: string | null;
  employee_id: string | null;
  counterparty_name: string | null;
  notes: string | null;
  paid_at: string | null;
  expense_receipt_no: string | null;
  created_at: string;
  updated_at: string;
  employee?: { full_name: string | null } | null;
};

export type BalanceSheetWelfareFundEntry = Pick<
  StaffWelfareFundLedgerEntry,
  "entry_date" | "entry_type" | "amount" | "status"
>;

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

function isActiveWelfareLiabilityEntry(
  entry: Pick<
    StaffWelfareFundLedgerEntry,
    "entry_type" | "amount" | "status"
  >,
): boolean {
  if (entry.status === "reversed") {
    return false;
  }

  if (entry.entry_type === "accrual" || entry.entry_type === "adjustment") {
    return entry.status === "open";
  }

  if (entry.entry_type === "disbursement") {
    return entry.status === "open" || entry.status === "settled";
  }

  return false;
}

function signedWelfareLiabilityAmount(
  entry: Pick<StaffWelfareFundLedgerEntry, "entry_type" | "amount">,
): number {
  const amount = Number(entry.amount) || 0;
  if (entry.entry_type === "disbursement") {
    return -amount;
  }
  return amount;
}

/** Current fund balance from ledger rows (open accruals/adjustments minus disbursements). */
export function calculateStaffWelfareFundBalance(
  entries: Pick<StaffWelfareFundLedgerEntry, "entry_type" | "amount" | "status">[],
): number {
  return roundCurrency(
    entries.reduce((sum, entry) => {
      if (!isActiveWelfareLiabilityEntry(entry)) {
        return sum;
      }
      return sum + signedWelfareLiabilityAmount(entry);
    }, 0),
  );
}

/**
 * Point-in-time Staff Welfare Payable for Balance Sheet (entry_date ≤ month-end).
 * Same lifecycle cutoff pattern as open tax_ledger statutory payables.
 */
export function calculateStaffWelfarePayableByMonth(
  entries: BalanceSheetWelfareFundEntry[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    let balance = 0;

    for (const entry of entries) {
      if (!isActiveWelfareLiabilityEntry(entry)) {
        continue;
      }

      const entryDate = normalizeDate(entry.entry_date);
      if (!entryDate || entryDate > monthEnd) {
        continue;
      }

      balance += signedWelfareLiabilityAmount(entry);
    }

    totals[month - 1] = roundCurrency(Math.max(balance, 0));
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return totals;
}

export function normalizeStaffWelfareFundEntry(
  raw: StaffWelfareFundLedgerEntry,
): StaffWelfareFundLedgerEntry {
  return {
    ...raw,
    entry_date: raw.entry_date?.slice(0, 10) ?? raw.entry_date,
    period_month: raw.period_month?.slice(0, 10) ?? null,
    amount: Number(raw.amount) || 0,
    paid_at: raw.paid_at ?? null,
    expense_receipt_no: raw.expense_receipt_no ?? null,
    employee_id: raw.employee_id ?? null,
    counterparty_name: raw.counterparty_name ?? null,
    notes: raw.notes ?? null,
    source_id: raw.source_id ?? null,
  };
}

export function buildStaffWelfareDisbursementReceiptNo(
  entryDate: string,
  ledgerId: string,
): string {
  const datePart = entryDate.slice(0, 10).replaceAll("-", "");
  const idPart = ledgerId.replaceAll("-", "").slice(0, 8).toUpperCase();
  return `WELFARE-DISB-${datePart}-${idPart}`;
}

export function getEntryTypeLabel(entryType: StaffWelfareFundEntryType): string {
  switch (entryType) {
    case "accrual":
      return "Accrual";
    case "disbursement":
      return "Disbursement";
    case "adjustment":
      return "Adjustment";
    default:
      return entryType;
  }
}

export function getWelfareFundStatusLabel(
  status: StaffWelfareFundLedgerStatus,
): string {
  switch (status) {
    case "open":
      return "Open";
    case "settled":
      return "Settled";
    case "reversed":
      return "Reversed";
    default:
      return status;
  }
}
