/**
 * Shared AP helpers for Balance Sheet liability and cash-settlement outflows.
 * Kept separate so cash-movement-utils can use them without importing
 * balance-sheet-utils (which already depends on the cash engine).
 */
import {
  PAYROLL_PAYABLE_CATEGORY_PAYE,
  PAYROLL_PAYABLE_CATEGORY_SSNIT,
} from "../hr-payroll/payroll-lock-finance-utils";

export type BalanceSheetAccountsPayableEntry = {
  id?: string;
  invoice_date: string;
  balance_due: number | null;
  amount: number;
  amount_paid: number;
  /** Used to soft-exclude historical statutory remittance AP (Option A). */
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
};

export type AccountsPayablePaymentLedgerRow = {
  accounts_payable_id?: string | null;
  payment_date: string;
  amount: number;
};

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeDate(value: string): string {
  return value.slice(0, 10);
}

/** Invoice face amount used for month-end AP outstanding (before payments). */
export function resolvePayableInvoiceAmount(
  entry: Pick<BalanceSheetAccountsPayableEntry, "amount" | "balance_due" | "amount_paid">,
): number {
  return Math.max(Number(entry.amount) || 0, 0);
}

/**
 * Current-row outstanding (legacy). Prefer getPayableOutstandingAsOf for BS history.
 */
export function getPayableBalanceFromCurrentRow(
  entry: BalanceSheetAccountsPayableEntry,
): number {
  if (entry.balance_due !== null && entry.balance_due !== undefined) {
    return Math.max(Number(entry.balance_due) || 0, 0);
  }

  return Math.max(
    (Number(entry.amount) || 0) - (Number(entry.amount_paid) || 0),
    0,
  );
}

function sumPaymentsOnOrBefore(
  payments: AccountsPayablePaymentLedgerRow[],
  accountsPayableId: string,
  asOfDate: string,
): number {
  let total = 0;
  for (const payment of payments) {
    if (payment.accounts_payable_id !== accountsPayableId) {
      continue;
    }
    const paymentDate = normalizeDate(payment.payment_date);
    if (!paymentDate || paymentDate > asOfDate) {
      continue;
    }
    total += Number(payment.amount) || 0;
  }
  return roundCurrency(total);
}

function payableHasPaymentLedgerRows(
  accountsPayableId: string | undefined,
  payments: AccountsPayablePaymentLedgerRow[],
): boolean {
  if (!accountsPayableId) {
    return false;
  }
  return payments.some(
    (row) => row.accounts_payable_id === accountsPayableId,
  );
}

/**
 * Operating AP outstanding at month-end: invoice amount minus payment-ledger
 * settlements dated on or before asOfDate. When an AP has no ledger rows, falls
 * back to current balance_due / amount_paid on the row (pre-migration behaviour).
 */
export function getPayableOutstandingAsOf(
  entry: BalanceSheetAccountsPayableEntry,
  asOfDate: string,
  payments: AccountsPayablePaymentLedgerRow[] = [],
): number {
  const invoiceDate = normalizeDate(entry.invoice_date);
  if (!invoiceDate || invoiceDate > asOfDate) {
    return 0;
  }

  const apId = entry.id?.trim();
  if (payableHasPaymentLedgerRows(apId, payments)) {
    const invoiceAmount = resolvePayableInvoiceAmount(entry);
    const paid = sumPaymentsOnOrBefore(payments, apId!, asOfDate);
    return Math.max(0, roundCurrency(invoiceAmount - paid));
  }

  return getPayableBalanceFromCurrentRow(entry);
}

/**
 * Option A soft-deprecation: tax_ledger_entries is SoR for SSNIT/PAYE remittance.
 * Exclude historical unpaid Statutory SSNIT/GRA AP so BS does not double-count
 * the same liability as both AP and open statutory_payable ledger rows.
 *
 * Match rule (any one):
 * - vendor_name is SSNIT or GRA (case-insensitive)
 * - expense_category is Statutory - SSNIT / Statutory - PAYE
 * - invoice_number starts with PAYROLL-SSNIT / PAYROLL-PAYE / PAYROLL-GRA
 */
export function isStatutoryRemittancePayable(entry: {
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
}): boolean {
  const vendor = entry.vendor_name?.trim().toUpperCase() ?? "";
  if (vendor === "SSNIT" || vendor === "GRA") {
    return true;
  }

  const category = entry.expense_category?.trim() ?? "";
  if (
    category === PAYROLL_PAYABLE_CATEGORY_SSNIT ||
    category === PAYROLL_PAYABLE_CATEGORY_PAYE
  ) {
    return true;
  }

  const invoice = entry.invoice_number?.trim().toUpperCase() ?? "";
  return (
    invoice.startsWith("PAYROLL-SSNIT") ||
    invoice.startsWith("PAYROLL-PAYE") ||
    invoice.startsWith("PAYROLL-GRA")
  );
}
