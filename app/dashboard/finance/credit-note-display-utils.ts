export type CreditNoteUsageAmounts = {
  total_amount: number;
  refunded_amount: number;
  applied_amount: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function creditNoteAvailableFromAmounts(row: CreditNoteUsageAmounts): number {
  const total = Number(row.total_amount) || 0;
  const refunded = Number(row.refunded_amount) || 0;
  const applied = Number(row.applied_amount) || 0;
  return Math.max(0, round2(total - refunded - applied));
}

export const CREDIT_NOTE_USAGE_FILTER_VALUES = [
  "Available",
  "Partly used",
  "Used",
  "Refunded",
] as const;

export type CreditNoteUsageFilterValue =
  (typeof CREDIT_NOTE_USAGE_FILTER_VALUES)[number];

export function formatCreditNoteUsageStatus(row: CreditNoteUsageAmounts): string {
  const total = round2(Number(row.total_amount) || 0);
  const refunded = round2(Number(row.refunded_amount) || 0);
  const applied = round2(Number(row.applied_amount) || 0);
  const balance = creditNoteAvailableFromAmounts(row);

  if (balance <= 0.01) {
    if (total > 0 && refunded >= total - 0.01 && applied <= 0.01) {
      return "Refunded";
    }
    return "Used";
  }

  if (applied > 0.01 || refunded > 0.01) {
    return "Partly used";
  }

  return "Available";
}
