import { GRA_RECONCILIATION_TOLERANCE } from "./statutory-due-rules";

export type GraPenaltyExpenseLink = {
  expenseId: string;
  date: string;
  amount: number;
};

export type GraReconciliationPenaltyRowState = {
  reconciliationId: string | null;
  penalties: GraPenaltyExpenseLink[];
};

export function parseGraPenaltyExpenseJoin(
  join:
    | { id: string; date: string; amount: number }
    | { id: string; date: string; amount: number }[]
    | null
    | undefined,
  fallbackExpenseId: string,
): GraPenaltyExpenseLink | null {
  const expenseRow = Array.isArray(join) ? join[0] : join;
  const expenseId = expenseRow?.id ?? fallbackExpenseId;
  if (!expenseId) {
    return null;
  }

  return {
    expenseId,
    date: expenseRow?.date ? String(expenseRow.date).slice(0, 10) : "",
    amount: expenseRow ? Number(expenseRow.amount) || 0 : 0,
  };
}

export function sumGraPenaltyRecordedAmount(
  penalties: GraPenaltyExpenseLink[],
): number {
  const total = penalties.reduce((sum, row) => sum + row.amount, 0);
  return Math.round(total * 100) / 100;
}

export function computeGraPenaltyRemainingAmount(
  requiredAmount: number,
  penalties: GraPenaltyExpenseLink[],
): number {
  const recorded = sumGraPenaltyRecordedAmount(penalties);
  const remaining = Math.round((requiredAmount - recorded) * 100) / 100;
  return remaining > GRA_RECONCILIATION_TOLERANCE ? remaining : 0;
}

export function isGraPenaltyFullyRecorded(
  requiredAmount: number,
  penalties: GraPenaltyExpenseLink[],
): boolean {
  if (requiredAmount <= GRA_RECONCILIATION_TOLERANCE) {
    return penalties.length > 0;
  }
  return computeGraPenaltyRemainingAmount(requiredAmount, penalties) === 0;
}
