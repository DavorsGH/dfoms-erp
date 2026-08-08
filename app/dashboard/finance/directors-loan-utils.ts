import { getPeriodMonthParts } from "./cash-flow-utils";
import {
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "./profit-loss-utils";

export type AccountsPayablePaymentRow = {
  tenant_id: string;
  payment_date: string;
  amount: number;
  payment_source: "company_cash" | "directors_loan";
};

export type DirectorsLoanRepaymentRow = {
  tenant_id: string;
  repayment_date: string;
  amount: number;
  applied_to_ap_component?: number | null;
  applied_to_manual_component?: number | null;
};

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

function assertTenantRows<T extends { tenant_id: string }>(
  rows: T[],
  tenantId: string,
  label: string,
): T[] {
  for (const row of rows) {
    if (row.tenant_id !== tenantId) {
      throw new Error(
        `${label}: tenant mismatch (expected ${tenantId}, got ${row.tenant_id})`,
      );
    }
  }
  return rows;
}

/** AP director-personal settlements: each payment adds in its month and carries forward. */
export function calculateDirectorsLoanFromAPPaymentsByMonth(
  payments: AccountsPayablePaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  assertTenantRows(payments, tenantId, "AP payments");

  const explicitByMonth = new Map<number, number>();
  for (const payment of payments) {
    if (payment.payment_source !== "directors_loan") {
      continue;
    }
    const monthIndex = getEntryMonthIndex(payment.payment_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    const month = monthIndex + 1;
    explicitByMonth.set(
      month,
      roundCurrency((explicitByMonth.get(month) ?? 0) + (Number(payment.amount) || 0)),
    );
  }

  const totals = createEmptyMonthlyTotals();
  let running = 0;
  for (let month = 1; month <= 12; month += 1) {
    if (explicitByMonth.has(month)) {
      running = roundCurrency(running + (explicitByMonth.get(month) ?? 0));
    }
    totals[month - 1] = running;
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return roundMonthlyTotals(totals);
}

/** Cumulative repayments reduce gross director loan from payment month forward within FY. */
export function calculateDirectorsLoanRepaymentsCumulativeByMonth(
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  assertTenantRows(repayments, tenantId, "directors loan repayments");

  const totals = createEmptyMonthlyTotals();
  let cumulative = 0;

  for (let month = 1; month <= 12; month += 1) {
    for (const repayment of repayments) {
      const monthIndex = getEntryMonthIndex(repayment.repayment_date, financialYear);
      if (monthIndex === null || monthIndex + 1 !== month) {
        continue;
      }
      cumulative = roundCurrency(cumulative + (Number(repayment.amount) || 0));
    }
    totals[month - 1] = cumulative;
  }

  totals[FULL_YEAR_INDEX] = totals[11];
  return roundMonthlyTotals(totals);
}

export function calculateDirectorsLoanNetByMonth(
  manualDirectorsLoanStock: MonthlyTotals,
  apPayments: AccountsPayablePaymentRow[],
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  const apStock = calculateDirectorsLoanFromAPPaymentsByMonth(
    apPayments,
    tenantId,
    financialYear,
  );
  const repaid = calculateDirectorsLoanRepaymentsCumulativeByMonth(
    repayments,
    tenantId,
    financialYear,
  );

  const totals = createEmptyMonthlyTotals();
  for (let i = 0; i < totals.length; i += 1) {
    totals[i] = roundCurrency(
      Math.max(
        0,
        (manualDirectorsLoanStock[i] ?? 0) + (apStock[i] ?? 0) - (repaid[i] ?? 0),
      ),
    );
  }
  return roundMonthlyTotals(totals);
}

/** Outstanding components as at a date (for repayment allocation preview). */
export function calculateDirectorsLoanOutstandingAsAt(
  manualDirectorsLoanStock: MonthlyTotals,
  apPayments: AccountsPayablePaymentRow[],
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  asAtDate: string,
  financialYear: number,
): { manualComponent: number; apComponent: number; netOutstanding: number } {
  const parts = getPeriodMonthParts(asAtDate);
  if (!parts || parts.year !== financialYear) {
    return { manualComponent: 0, apComponent: 0, netOutstanding: 0 };
  }

  const apStock = calculateDirectorsLoanFromAPPaymentsByMonth(
    apPayments,
    tenantId,
    financialYear,
  );
  const repaid = calculateDirectorsLoanRepaymentsCumulativeByMonth(
    repayments,
    tenantId,
    financialYear,
  );

  const monthIndex = parts.month - 1;
  const manualComponent = roundCurrency(manualDirectorsLoanStock[monthIndex] ?? 0);
  const apComponent = roundCurrency(apStock[monthIndex] ?? 0);
  const repaidToDate = roundCurrency(repaid[monthIndex] ?? 0);
  const gross = roundCurrency(manualComponent + apComponent);
  const netOutstanding = roundCurrency(Math.max(0, gross - repaidToDate));

  return { manualComponent, apComponent, netOutstanding };
}

/** AP-system first, then manual (immutable audit split at save time). */
export function allocateDirectorsLoanRepayment(
  repaymentAmount: number,
  manualComponent: number,
  apComponent: number,
  priorRepaymentsAppliedToAp: number,
  priorRepaymentsAppliedToManual: number,
): { appliedToAp: number; appliedToManual: number } {
  const apOutstanding = roundCurrency(
    Math.max(0, apComponent - priorRepaymentsAppliedToAp),
  );
  const manualOutstanding = roundCurrency(
    Math.max(0, manualComponent - priorRepaymentsAppliedToManual),
  );
  const appliedToAp = roundCurrency(Math.min(repaymentAmount, apOutstanding));
  const appliedToManual = roundCurrency(
    Math.min(repaymentAmount - appliedToAp, manualOutstanding),
  );
  return { appliedToAp, appliedToManual };
}

export function sumPriorRepaymentAllocations(
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  beforeDate: string,
): { ap: number; manual: number } {
  assertTenantRows(repayments, tenantId, "directors loan repayments");
  let ap = 0;
  let manual = 0;
  for (const row of repayments) {
    if (String(row.repayment_date).slice(0, 10) >= beforeDate.slice(0, 10)) {
      continue;
    }
    ap = roundCurrency(ap + (Number(row.applied_to_ap_component) || 0));
    manual = roundCurrency(manual + (Number(row.applied_to_manual_component) || 0));
  }
  return { ap, manual };
}

export function calculateDirectorsLoanRepaymentOutflowsByMonth(
  repayments: DirectorsLoanRepaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  assertTenantRows(repayments, tenantId, "directors loan repayments");
  const totals = createEmptyMonthlyTotals();

  for (const repayment of repayments) {
    const amount = Number(repayment.amount) || 0;
    if (amount <= 0) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(repayment.repayment_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    totals[monthIndex] = roundCurrency((totals[monthIndex] ?? 0) + amount);
    totals[FULL_YEAR_INDEX] = roundCurrency((totals[FULL_YEAR_INDEX] ?? 0) + amount);
  }

  return roundMonthlyTotals(totals);
}

export function calculateAccountsPayableCashOutflowsFromPayments(
  payments: AccountsPayablePaymentRow[],
  tenantId: string,
  financialYear: number,
): MonthlyTotals {
  assertTenantRows(payments, tenantId, "AP payments");
  const totals = createEmptyMonthlyTotals();

  for (const payment of payments) {
    if (payment.payment_source !== "company_cash") {
      continue;
    }
    const amount = Number(payment.amount) || 0;
    if (amount <= 0) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(payment.payment_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    totals[monthIndex] = roundCurrency((totals[monthIndex] ?? 0) + amount);
    totals[FULL_YEAR_INDEX] = roundCurrency((totals[FULL_YEAR_INDEX] ?? 0) + amount);
  }

  return roundMonthlyTotals(totals);
}
