/** Deep-link helpers for Director's Scorecard checklist and budget table (URLs only). */

export type DirectorScorecardChecklistLink = {
  label: string;
  href: string;
};

export type DirectorScorecardUnpaidInvoiceLink = {
  id: string;
  invoiceNumber: string;
};

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function balanceSheetHrefForScorecardMonth(
  year: number,
  month: number,
): string {
  const params = new URLSearchParams();
  params.set("year", String(year));
  params.set("focusMonth", String(month - 1));
  return `/dashboard/finance/balance-sheet?${params.toString()}`;
}

export function clientInvoicesListHref(options?: {
  unpaidOnly?: boolean;
}): string {
  if (options?.unpaidOnly) {
    return "/dashboard/finance/client-invoices?status=unpaid";
  }
  return "/dashboard/finance/client-invoices";
}

export function clientInvoiceDetailHref(invoiceId: string): string {
  return `/dashboard/finance/client-invoices/${encodeURIComponent(invoiceId)}`;
}

/** Statutory Ledger accepts `periodMonth` as YYYY-MM (see tax-ledger.tsx). */
export function statutoryLedgerHref(periodMonthYyyyMm?: string | null): string {
  if (!periodMonthYyyyMm?.trim()) {
    return "/dashboard/finance/tax-ledger";
  }
  const params = new URLSearchParams();
  params.set("periodMonth", periodMonthYyyyMm.trim().slice(0, 7));
  return `/dashboard/finance/tax-ledger?${params.toString()}`;
}

export function expenseRegisterHrefForBudgetLine(input: {
  year: number;
  month: number;
  category: string;
  subcategory: string | null;
  projectId?: string | null;
}): string {
  const monthPadded = String(input.month).padStart(2, "0");
  const from = `${input.year}-${monthPadded}-01`;
  const to = `${input.year}-${monthPadded}-${String(lastDayOfMonth(input.year, input.month)).padStart(2, "0")}`;
  const params = new URLSearchParams();
  params.set("dateFrom", from);
  params.set("dateTo", to);
  if (input.category.trim()) {
    params.set("category", input.category.trim());
  }
  if (input.subcategory?.trim()) {
    params.set("subCategory", input.subcategory.trim());
  }
  if (input.projectId?.trim()) {
    params.set("projectId", input.projectId.trim());
  }
  return `/dashboard/finance/expenses?${params.toString()}`;
}

export function periodMonthToTaxLedgerParam(periodMonth: string): string {
  return periodMonth.trim().slice(0, 7);
}
