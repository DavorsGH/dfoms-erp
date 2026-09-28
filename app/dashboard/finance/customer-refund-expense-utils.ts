import { normalizeCategoryName, shouldIncludeExpenseInProfitLoss } from "./profit-loss-utils";

/** Columns required on expense_register rows used in P&L / dashboard expense rollups. */
export const EXPENSE_REGISTER_NON_CASH_ROLLUP_FIELDS =
  "is_customer_refund" as const;

/** P&L + cash-flow expense loads (category gate + refund flag). */
export const EXPENSE_REGISTER_PROFIT_LOSS_SELECT =
  "date, expense_category, sub_category, amount, net_of_tax_amount, input_vat_amount, is_customer_refund";

/** Balance sheet / cash engine expense loads (payment + refund flag). */
export const EXPENSE_REGISTER_CASH_FLOW_SELECT =
  "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, is_customer_refund";

export type CustomerRefundExpenseMarker = {
  is_customer_refund?: boolean | null;
  /** Optional cross-check when both are present on the row. */
  id?: string;
};

export type RefundExpenseRegisterLink = {
  expense_register_id?: string | null;
};

/**
 * Cash refund to customer (balance-sheet cash outflow only — not operating expense).
 */
export function isCustomerRefundCashOutflowExpense(
  entry: CustomerRefundExpenseMarker,
  refundLink?: RefundExpenseRegisterLink | null,
): boolean {
  if (entry.is_customer_refund === true) {
    return true;
  }
  if (
    entry.id &&
    refundLink?.expense_register_id &&
    refundLink.expense_register_id === entry.id
  ) {
    return true;
  }
  return false;
}

export function shouldIncludeExpenseInNonCashTotals(entry: {
  expense_category: string;
  is_customer_refund?: boolean | null;
}): boolean {
  if (isCustomerRefundCashOutflowExpense(entry)) {
    return false;
  }
  return shouldIncludeExpenseInProfitLoss(entry.expense_category);
}

export function isProductReturnCogsReversalExpense(entry: {
  expense_category?: string | null;
  sub_category?: string | null;
}): boolean {
  return (
    normalizeCategoryName(entry.expense_category ?? "") ===
      normalizeCategoryName("Cost of Goods Sold") &&
    normalizeCategoryName(entry.sub_category ?? "") ===
      normalizeCategoryName("Product Returns")
  );
}
