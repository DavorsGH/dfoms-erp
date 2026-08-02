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
  invoice_date: string;
  balance_due: number | null;
  amount: number;
  amount_paid: number;
  /** Used to soft-exclude historical statutory remittance AP (Option A). */
  vendor_name?: string | null;
  invoice_number?: string | null;
  expense_category?: string | null;
};

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
