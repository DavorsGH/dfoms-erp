import type { SupabaseClient } from "@supabase/supabase-js";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import { isApAccrualExpenseRegisterRow } from "@/utils/manual-expense-payment-status";
import {
  PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
} from "../hr-payroll/payroll-lock-finance-utils";
import {
  parseAccountsPayableIdFromAccrualReceiptNo,
} from "./accounts-payable-accrual-utils";
import {
  formatGHS,
  getRemainingPayableBalance,
  normalizeAccountsPayableEntry,
  type AccountsPayableEntry,
} from "./accounts-payable-utils";
import { resolveRegisterPaymentMethodLabel } from "./register-detail-labels";
import type { NamedLookup } from "../lookup-types";

export const AP_ACCRUAL_EXPENSE_EDIT_DISABLED_TITLE =
  "Managed by Accounts Payable — edit or pay the bill instead.";

export const AP_ACCRUAL_EXPENSE_PAYMENT_METHOD_LABEL = "Via Accounts Payable";

export const AP_ACCRUAL_PAID_VIA_AP_LABEL = "Paid via Accounts Payable";
export const AP_ACCRUAL_ORPHAN_STATUS_LABEL = "Accrued — linked bill not found";

const AP_LINKED_PAYABLE_SELECT =
  "id, amount, amount_paid, balance_due" as const;

export type ApAccrualLinkedPayableSummary = Pick<
  AccountsPayableEntry,
  "id" | "amount" | "amount_paid" | "balance_due"
>;

export type ApAccrualPaymentStatusTone =
  | "paid_via_ap"
  | "partial_via_ap"
  | "accrued"
  | "orphan";

export type ApAccrualPaymentStatusDisplay = {
  label: string;
  tone: ApAccrualPaymentStatusTone;
  apId: string;
};

export function accountsPayableHref(apId: string): string {
  return `/dashboard/finance/accounts-payable?apId=${encodeURIComponent(apId)}`;
}

export function collectApIdsFromApAccrualExpenseEntries(
  entries: Array<{ receipt_no?: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    const apId = parseAccountsPayableIdFromAccrualReceiptNo(entry.receipt_no);
    if (apId) {
      ids.add(apId);
    }
  }
  return [...ids];
}

export async function fetchLinkedAccountsPayableForApAccrualExpenses(
  supabase: SupabaseClient,
  buReadScope: BusinessUnitReadScope,
  apIds: string[],
): Promise<Map<string, ApAccrualLinkedPayableSummary>> {
  const map = new Map<string, ApAccrualLinkedPayableSummary>();
  if (apIds.length === 0) {
    return map;
  }

  const chunkSize = 100;
  for (let offset = 0; offset < apIds.length; offset += chunkSize) {
    const chunk = apIds.slice(offset, offset + chunkSize);
    const { data, error } = await applyBusinessUnitScope(
      supabase.from("accounts_payable").select(AP_LINKED_PAYABLE_SELECT).in("id", chunk),
      buReadScope,
    );

    if (error) {
      throw new Error(error.message);
    }

    for (const row of data ?? []) {
      const normalized = normalizeAccountsPayableEntry(
        row as AccountsPayableEntry,
      );
      map.set(normalized.id, {
        id: normalized.id,
        amount: normalized.amount,
        amount_paid: normalized.amount_paid,
        balance_due: normalized.balance_due,
      });
    }
  }

  return map;
}

export function buildApAccrualPaymentStatusDisplay(
  apId: string,
  linked: ApAccrualLinkedPayableSummary | undefined,
  options?: { linkedPayablesLoaded?: boolean },
): ApAccrualPaymentStatusDisplay {
  if (!linked) {
    if (options?.linkedPayablesLoaded === false) {
      return {
        label: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
        tone: "accrued",
        apId,
      };
    }
    return {
      label: AP_ACCRUAL_ORPHAN_STATUS_LABEL,
      tone: "orphan",
      apId,
    };
  }

  const total = Number(linked.amount) || 0;
  const paid = Number(linked.amount_paid) || 0;
  const balance = getRemainingPayableBalance(linked);

  if (balance <= 0 || (total > 0 && paid >= total)) {
    return {
      label: AP_ACCRUAL_PAID_VIA_AP_LABEL,
      tone: "paid_via_ap",
      apId,
    };
  }

  if (paid > 0 && balance > 0) {
    return {
      label: `Partially paid via Accounts Payable (${formatGHS(paid)} of ${formatGHS(total)})`,
      tone: "partial_via_ap",
      apId,
    };
  }

  return {
    label: PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
    tone: "accrued",
    apId,
  };
}

export function resolveApAccrualPaymentStatusDisplay(
  entry: { receipt_no?: string | null },
  linkedPayablesById: Map<string, ApAccrualLinkedPayableSummary>,
  options?: { linkedPayablesLoaded?: boolean },
): ApAccrualPaymentStatusDisplay | null {
  const apId = parseAccountsPayableIdFromAccrualReceiptNo(entry.receipt_no);
  if (!apId) {
    return null;
  }
  return buildApAccrualPaymentStatusDisplay(
    apId,
    linkedPayablesById.get(apId),
    options,
  );
}

/** Display-only payment status (stored value unchanged in DB). */
export function resolveExpenseRegisterPaymentStatusLabel(
  entry: { receipt_no?: string | null; payment_status?: string | null },
  linkedPayablesById: Map<string, ApAccrualLinkedPayableSummary>,
  options?: { linkedPayablesLoaded?: boolean },
): string {
  const derived = resolveApAccrualPaymentStatusDisplay(
    entry,
    linkedPayablesById,
    options,
  );
  if (derived) {
    return derived.label;
  }
  return (entry.payment_status ?? "").trim() || "—";
}

export function resolveExpenseRegisterPaymentMethodLabel(
  entry: {
    receipt_no?: string | null;
    payment_method?: string | null;
  },
  paymentMethods: NamedLookup[],
): string {
  if (isApAccrualExpenseRegisterRow(entry)) {
    return AP_ACCRUAL_EXPENSE_PAYMENT_METHOD_LABEL;
  }
  return resolveRegisterPaymentMethodLabel(entry.payment_method, paymentMethods);
}

export function apAccrualPaymentStatusToneClassName(
  tone: ApAccrualPaymentStatusTone,
): string {
  switch (tone) {
    case "paid_via_ap":
      return "font-medium text-emerald-800";
    case "orphan":
      return "font-medium text-amber-800";
    case "partial_via_ap":
      return "text-slate-800";
    default:
      return "text-slate-800";
  }
}

/** True when stored method is AP accrual (legacy label "Accrual"). */
export function isApAccrualStoredPaymentMethod(
  paymentMethod: string | null | undefined,
): boolean {
  return (
    (paymentMethod ?? "").trim().toLowerCase() ===
    PAYROLL_EXPENSE_PAYMENT_METHOD_ACCRUAL.toLowerCase()
  );
}
