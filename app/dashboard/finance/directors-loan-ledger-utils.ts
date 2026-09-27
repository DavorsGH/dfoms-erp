import { getMonthEndDate } from "./capital-contributions-utils";
import {
  calculateDirectorsLoanFromAPPaymentsByMonth,
  calculateDirectorsLoanNetByMonth,
  calculateDirectorsLoanRepaymentOutflowsByMonth,
  type AccountsPayablePaymentRow,
  type DirectorsLoanRepaymentRow,
} from "./directors-loan-utils";
import { getPeriodMonthParts } from "./cash-flow-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "./profit-loss-utils";
import type { CashMovementManualEntry } from "./cash-movement-utils";

export const DIRECTORS_LOAN_LEDGER_SELECT =
  "id, tenant_id, business_unit_id, entry_date, entry_type, amount, description, reference, notes, linked_expense_id, reversed_at, reversed_by, reversal_reason, created_at, created_by";

export type DirectorsLoanLedgerEntryType =
  | "director_lent_company"
  | "company_repaid_director"
  | "company_paid_for_director"
  | "director_repaid_company";

export type DirectorsLoanLedgerEntry = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  entry_date: string;
  entry_type: DirectorsLoanLedgerEntryType;
  amount: number;
  description: string;
  reference: string | null;
  notes: string | null;
  linked_expense_id: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_reason: string | null;
  created_at: string;
  created_by: string | null;
};

export const DIRECTORS_LOAN_ENTRY_TYPE_LABELS: Record<
  DirectorsLoanLedgerEntryType,
  string
> = {
  director_lent_company: "I lent the company money",
  company_repaid_director: "Company repaid me",
  company_paid_for_director: "Company paid for my personal expense",
  director_repaid_company: "I repaid the company",
};

/** Plain-language cash + balance effect shown under the Type field in the form. */
export const DIRECTORS_LOAN_ENTRY_TYPE_EFFECT_HINTS: Record<
  DirectorsLoanLedgerEntryType,
  string
> = {
  director_lent_company:
    "Cash into the business · the company will owe you more",
  company_repaid_director:
    "Cash out of the business · the company owes you less",
  company_paid_for_director:
    "Cash out of the business · you will owe the company",
  director_repaid_company:
    "Cash into the business · you owe the company less",
};

export const DIRECTORS_LOAN_NON_CASH_REFERENCE_PREFIX = "[non-cash]";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

export function isActiveDirectorsLoanLedgerEntry(
  entry: Pick<DirectorsLoanLedgerEntry, "reversed_at">,
): boolean {
  return !entry.reversed_at;
}

export function isNonCashDirectorsLoanLedgerEntry(
  entry: Pick<DirectorsLoanLedgerEntry, "reference">,
): boolean {
  return (entry.reference ?? "")
    .trim()
    .startsWith(DIRECTORS_LOAN_NON_CASH_REFERENCE_PREFIX);
}

export function signedOwedToDirectorDelta(
  entry: Pick<DirectorsLoanLedgerEntry, "entry_type" | "amount">,
): number {
  const amount = Number(entry.amount) || 0;
  if (entry.entry_type === "director_lent_company") {
    return amount;
  }
  if (entry.entry_type === "company_repaid_director") {
    return -amount;
  }
  return 0;
}

export function signedOwedByDirectorDelta(
  entry: Pick<DirectorsLoanLedgerEntry, "entry_type" | "amount">,
): number {
  const amount = Number(entry.amount) || 0;
  if (entry.entry_type === "company_paid_for_director") {
    return amount;
  }
  if (entry.entry_type === "director_repaid_company") {
    return -amount;
  }
  return 0;
}

export function cashFlowSignedAmount(
  entry: Pick<
    DirectorsLoanLedgerEntry,
    "entry_type" | "amount" | "reference" | "reversed_at"
  >,
): number {
  if (!isActiveDirectorsLoanLedgerEntry(entry)) {
    return 0;
  }
  if (isNonCashDirectorsLoanLedgerEntry(entry)) {
    return 0;
  }
  const amount = Number(entry.amount) || 0;
  switch (entry.entry_type) {
    case "director_lent_company":
    case "director_repaid_company":
      return amount;
    case "company_repaid_director":
    case "company_paid_for_director":
      return -amount;
    default:
      return 0;
  }
}

export type DirectorsLoanPosition = {
  owedToDirector: number;
  owedByDirector: number;
  netPosition: number;
};

export function calculateDirectorsLoanPositionAsAt(
  ledgerEntries: DirectorsLoanLedgerEntry[],
  apPayments: AccountsPayablePaymentRow[],
  tenantId: string,
  asAtDate: string,
  financialYear: number,
): DirectorsLoanPosition {
  const asAt = asAtDate.slice(0, 10);
  let owedToDirector = 0;
  let owedByDirector = 0;

  for (const entry of ledgerEntries) {
    if (!isActiveDirectorsLoanLedgerEntry(entry)) {
      continue;
    }
    if (entry.entry_date.slice(0, 10) > asAt) {
      continue;
    }
    owedToDirector = roundCurrency(
      owedToDirector + signedOwedToDirectorDelta(entry),
    );
    owedByDirector = roundCurrency(
      owedByDirector + signedOwedByDirectorDelta(entry),
    );
  }

  const parts = getPeriodMonthParts(asAt);
  if (parts && parts.year === financialYear) {
    const apStock = calculateDirectorsLoanFromAPPaymentsByMonth(
      apPayments,
      tenantId,
      financialYear,
    );
    owedToDirector = roundCurrency(
      owedToDirector + (apStock[parts.month - 1] ?? 0),
    );
  }

  const netPosition = roundCurrency(owedToDirector - owedByDirector);
  return { owedToDirector, owedByDirector, netPosition };
}

/** UI-only: show owed-to / owed-by as non-negative amounts (net position unchanged). */
export function normalizeDirectorsLoanPositionDisplay(
  position: DirectorsLoanPosition,
): Pick<DirectorsLoanPosition, "owedToDirector" | "owedByDirector"> {
  let owedToDirector = position.owedToDirector;
  let owedByDirector = position.owedByDirector;
  if (owedToDirector < -0.005) {
    owedByDirector = roundCurrency(owedByDirector + Math.abs(owedToDirector));
    owedToDirector = 0;
  }
  if (owedByDirector < -0.005) {
    owedToDirector = roundCurrency(owedToDirector + Math.abs(owedByDirector));
    owedByDirector = 0;
  }
  return {
    owedToDirector: roundCurrency(Math.max(0, owedToDirector)),
    owedByDirector: roundCurrency(Math.max(0, owedByDirector)),
  };
}

export function formatDirectorsLoanPositionLabel(position: DirectorsLoanPosition): string {
  const net = position.netPosition;
  if (Math.abs(net) < 0.005) {
    return "Director and company are square (GHS 0.00 net).";
  }
  if (net > 0) {
    return `Company owes director ${formatGhs(net)}`;
  }
  return `Director owes company ${formatGhs(Math.abs(net))}`;
}

function formatGhs(value: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function calculateDirectorsLoanLedgerNetByMonth(
  ledgerEntries: DirectorsLoanLedgerEntry[],
  apPayments: AccountsPayablePaymentRow[],
  tenantId: string,
  financialYear: number,
): { liability: MonthlyTotals; dueFromDirector: MonthlyTotals } {
  const liability = createEmptyMonthlyTotals();
  const dueFromDirector = createEmptyMonthlyTotals();

  for (let month = 1; month <= 12; month += 1) {
    const monthEnd = getMonthEndDate(financialYear, month);
    const position = calculateDirectorsLoanPositionAsAt(
      ledgerEntries,
      apPayments,
      tenantId,
      monthEnd,
      financialYear,
    );
    if (position.netPosition > 0) {
      liability[month - 1] = position.netPosition;
    } else if (position.netPosition < 0) {
      dueFromDirector[month - 1] = Math.abs(position.netPosition);
    }
  }

  liability[FULL_YEAR_INDEX] = liability[11];
  dueFromDirector[FULL_YEAR_INDEX] = dueFromDirector[11];
  return {
    liability: roundMonthlyTotals(liability),
    dueFromDirector: roundMonthlyTotals(dueFromDirector),
  };
}

export function calculateDirectorsLoanLedgerCashByMonth(
  ledgerEntries: DirectorsLoanLedgerEntry[],
  tenantId: string,
  financialYear: number,
): { inflows: MonthlyTotals; outflows: MonthlyTotals } {
  const inflows = createEmptyMonthlyTotals();
  const outflows = createEmptyMonthlyTotals();

  for (const entry of ledgerEntries) {
    if (entry.tenant_id !== tenantId) {
      continue;
    }
    const signed = cashFlowSignedAmount(entry);
    if (signed === 0) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(entry.entry_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    if (signed > 0) {
      inflows[monthIndex] = roundCurrency(inflows[monthIndex] + signed);
      inflows[FULL_YEAR_INDEX] = roundCurrency(
        inflows[FULL_YEAR_INDEX] + signed,
      );
    } else {
      const out = Math.abs(signed);
      outflows[monthIndex] = roundCurrency(outflows[monthIndex] + out);
      outflows[FULL_YEAR_INDEX] = roundCurrency(outflows[FULL_YEAR_INDEX] + out);
    }
  }

  return {
    inflows: roundMonthlyTotals(inflows),
    outflows: roundMonthlyTotals(outflows),
  };
}

export function shouldUseDirectorsLoanLedger(
  ledgerEntries: DirectorsLoanLedgerEntry[],
): boolean {
  return ledgerEntries.some(isActiveDirectorsLoanLedgerEntry);
}

export function calculateLegacyDirectorsLoanLiabilityByMonth(
  manualDirectorsLoanStock: MonthlyTotals,
  apPayments: AccountsPayablePaymentRow[],
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  return calculateDirectorsLoanNetByMonth(
    manualDirectorsLoanStock,
    apPayments,
    repayments,
    tenantId,
    financialYear,
  );
}

export function calculateDirectorsLoanLiabilityByMonth(
  manualDirectorsLoanStock: MonthlyTotals,
  apPayments: AccountsPayablePaymentRow[],
  repayments: DirectorsLoanRepaymentRow[],
  ledgerEntries: DirectorsLoanLedgerEntry[],
  tenantId: string,
  financialYear: number,
): { liability: MonthlyTotals; dueFromDirector: MonthlyTotals } {
  if (shouldUseDirectorsLoanLedger(ledgerEntries)) {
    return calculateDirectorsLoanLedgerNetByMonth(
      ledgerEntries,
      apPayments,
      tenantId,
      financialYear,
    );
  }

  const legacy = calculateLegacyDirectorsLoanLiabilityByMonth(
    manualDirectorsLoanStock,
    apPayments,
    repayments,
    tenantId,
    financialYear,
  );
  return { liability: legacy, dueFromDirector: createEmptyMonthlyTotals() };
}

export function calculateDirectorsLoanCashOutflowsByMonth(
  repayments: DirectorsLoanRepaymentRow[],
  ledgerEntries: DirectorsLoanLedgerEntry[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  if (shouldUseDirectorsLoanLedger(ledgerEntries)) {
    return calculateDirectorsLoanLedgerCashByMonth(
      ledgerEntries,
      tenantId,
      financialYear,
    ).outflows;
  }
  return calculateDirectorsLoanRepaymentOutflowsByMonth(
    repayments,
    tenantId,
    financialYear,
  );
}

export function calculateDirectorsLoanCashInflowsByMonth(
  ledgerEntries: DirectorsLoanLedgerEntry[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  if (!shouldUseDirectorsLoanLedger(ledgerEntries)) {
    return createEmptyMonthlyTotals();
  }
  return calculateDirectorsLoanLedgerCashByMonth(
    ledgerEntries,
    tenantId,
    financialYear,
  ).inflows;
}
