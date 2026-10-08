import {
  AP_ACCRUAL_DESCRIPTION_PREFIX,
  AP_ACCRUAL_RECEIPT_PREFIX,
} from "@/app/dashboard/finance/accounts-payable-accrual-utils";
import { isPaidStatus } from "@/app/dashboard/finance/accrued-wages-utils";
import { expenseRegisterAutoPostLockMessage } from "@/app/dashboard/finance/register-auto-posted-utils";
import { AP_ACCRUAL_EXPENSE_EDIT_DISABLED_TITLE } from "@/app/dashboard/finance/expense-register-ap-accrual-display";

const NON_CASH_EXPENSE_REGISTER_LOCK_MESSAGE =
  "Non-cash system expense (inventory / COGS). Reverse at the originating module — do not edit or delete here.";

export const MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS = "Paid" as const;

export const MANUAL_EXPENSE_UNPAID_USE_ACCOUNTS_PAYABLE_MESSAGE =
  "Manual expense entries must use payment status Paid (cash already spent). To track an amount still owed, create the bill in Finance → Accounts Payable instead of Pending, Accrued, or other unpaid statuses.";

export function isApAccrualExpenseRegisterRow(entry: {
  receipt_no?: string | null;
  description?: string | null;
}): boolean {
  const receipt = (entry.receipt_no ?? "").trim();
  if (receipt.toUpperCase().startsWith(AP_ACCRUAL_RECEIPT_PREFIX.toUpperCase())) {
    return true;
  }
  return (entry.description ?? "").trim().startsWith(AP_ACCRUAL_DESCRIPTION_PREFIX);
}

export function resolveExpenseRegisterLockMessage(entry: {
  description?: string | null;
  receipt_no?: string | null;
  expense_category?: string | null;
  sub_category?: string | null;
  is_customer_refund?: boolean | null;
  payment_status?: string | null;
  vendor?: string | null;
}): string | null {
  if (isApAccrualExpenseRegisterRow(entry)) {
    return AP_ACCRUAL_EXPENSE_EDIT_DISABLED_TITLE;
  }
  const autoMessage = expenseRegisterAutoPostLockMessage(entry);
  if (autoMessage) {
    return autoMessage;
  }
  const status = (entry.payment_status ?? "").trim().toLowerCase();
  if (status === "non-cash") {
    return NON_CASH_EXPENSE_REGISTER_LOCK_MESSAGE;
  }
  return null;
}

/** Rows that must not be edited via the manual Expense Register form. */
export function isSystemManagedExpenseRegisterRow(entry: {
  description?: string | null;
  receipt_no?: string | null;
  expense_category?: string | null;
  sub_category?: string | null;
  is_customer_refund?: boolean | null;
  payment_status?: string | null;
  vendor?: string | null;
}): boolean {
  return resolveExpenseRegisterLockMessage(entry) != null;
}

export function manualExpensePaymentStatusSelectOptions(
  editing: boolean,
  currentStatus: string | null | undefined,
): string[] {
  if (!editing) {
    return [MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS];
  }
  const current = (currentStatus ?? "").trim();
  if (!current || isPaidStatus(current)) {
    return [MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS];
  }
  return [current, MANUAL_EXPENSE_REGISTER_PAYMENT_STATUS];
}

export function validateManualExpenseRegisterPaymentStatusForWrite(
  paymentStatus: string | null | undefined,
): string | null {
  if (!isPaidStatus(paymentStatus)) {
    return MANUAL_EXPENSE_UNPAID_USE_ACCOUNTS_PAYABLE_MESSAGE;
  }
  return null;
}
