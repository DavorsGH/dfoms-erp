import { getMonthEndDate } from "./capital-contributions-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  type MonthlyTotals,
} from "./profit-loss-utils";

export type CustomerCreditsCreditNoteRow = {
  id: string;
  credit_note_date: string;
  total_amount: number;
};

export type CustomerCreditsRefundRow = {
  credit_note_id: string;
  refund_date: string;
  amount: number;
};

export type CustomerCreditsApplicationRow = {
  credit_note_id: string;
  applied_date: string;
  amount: number;
};

/** Child rows of credit_notes (refunds, applications) have no business_unit_id — scope via note ids. */
export function filterCreditNoteChildRowsForScopedNotes<
  T extends { credit_note_id: unknown },
>(rows: T[], scopedCreditNoteIds: ReadonlySet<string>): T[] {
  if (scopedCreditNoteIds.size === 0) {
    return [];
  }
  return rows.filter((row) =>
    scopedCreditNoteIds.has(String(row.credit_note_id)),
  );
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function dateOnOrBefore(date: string, asOf: string): boolean {
  return date.slice(0, 10) <= asOf.slice(0, 10);
}

function sumRefundedThrough(
  noteId: string,
  asOf: string,
  refunds: CustomerCreditsRefundRow[],
): number {
  return refunds.reduce((sum, row) => {
    if (row.credit_note_id !== noteId) {
      return sum;
    }
    if (!dateOnOrBefore(row.refund_date, asOf)) {
      return sum;
    }
    return sum + (Number(row.amount) || 0);
  }, 0);
}

function sumAppliedThrough(
  noteId: string,
  asOf: string,
  applications: CustomerCreditsApplicationRow[],
): number {
  return applications.reduce((sum, row) => {
    if (row.credit_note_id !== noteId) {
      return sum;
    }
    if (!dateOnOrBefore(row.applied_date, asOf)) {
      return sum;
    }
    return sum + (Number(row.amount) || 0);
  }, 0);
}

export function customerCreditsBalanceAsOf(
  creditNotes: CustomerCreditsCreditNoteRow[],
  refunds: CustomerCreditsRefundRow[],
  applications: CustomerCreditsApplicationRow[],
  asOfDate: string,
): number {
  let total = 0;
  for (const note of creditNotes) {
    const noteDate = note.credit_note_date?.slice(0, 10) ?? "";
    if (!noteDate || noteDate > asOfDate.slice(0, 10)) {
      continue;
    }
    const noteTotal = Number(note.total_amount) || 0;
    const refunded = sumRefundedThrough(note.id, asOfDate, refunds);
    const applied = sumAppliedThrough(note.id, asOfDate, applications);
    total += Math.max(0, noteTotal - refunded - applied);
  }
  return roundCurrency(total);
}

/**
 * Point-in-time customer credits liability by calendar month (stock at month-end).
 */
export function calculateCustomerCreditsPayableByMonth(
  creditNotes: CustomerCreditsCreditNoteRow[],
  refunds: CustomerCreditsRefundRow[],
  applications: CustomerCreditsApplicationRow[],
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthEnd = getMonthEndDate(financialYear, monthIndex + 1);
    totals[monthIndex] = customerCreditsBalanceAsOf(
      creditNotes,
      refunds,
      applications,
      monthEnd,
    );
  }
  totals[FULL_YEAR_INDEX] = totals[11] ?? 0;
  return totals;
}
