import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { paystackApplyErrorReason } from "@/utils/manual-sale-paystack";

export const APPLY_PRODUCT_SALE_PAYSTACK_PAYMENT =
  "apply_product_sale_paystack_payment";

export type PaystackApplyResult = {
  ok?: boolean;
  already_applied?: boolean;
  invoice_no?: string | null;
  income_ids?: string[] | null;
  applied_amount?: number | string | null;
  unallocated_amount?: number | string | null;
};

function moneyFromRpc(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(amount * 100) / 100;
}

export function isMissingPaystackApplyFunction(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = (error.code ?? "").trim();
  const message = (error.message ?? "").toLowerCase();
  if (code === "PGRST202" || code === "42883") {
    return true;
  }
  return (
    message.includes(APPLY_PRODUCT_SALE_PAYSTACK_PAYMENT) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find"))
  );
}

/**
 * Calls apply_product_sale_paystack_payment when it is installed.
 * A missing function is `missing` so the current multi-statement path still runs.
 * Any other database error is returned and must not be treated as success.
 */
export async function tryApplyProductSalePaystackPayment(
  admin: SupabaseClient,
  input: { requestId: string; reference: string; amount: number },
): Promise<
  | {
      status: "applied";
      invoiceNo: string;
      incomeIds: string[];
      alreadyApplied: boolean;
      appliedAmount: number;
      unallocatedAmount: number;
    }
  | { status: "missing" }
  | { status: "error"; error: string }
> {
  const reference = input.reference.trim();
  if (!input.requestId.trim() || !reference) {
    return { status: "error", error: "Paystack reference is required." };
  }
  const { data, error } = await admin.rpc(APPLY_PRODUCT_SALE_PAYSTACK_PAYMENT, {
    p_request_id: input.requestId,
    p_reference: reference,
    p_amount: input.amount,
  });
  if (error) {
    if (isMissingPaystackApplyFunction(error)) {
      return { status: "missing" };
    }
    return { status: "error", error: paystackApplyErrorReason(error.message) };
  }
  const payload = (data ?? {}) as PaystackApplyResult;
  if (payload.ok === false) {
    return {
      status: "error",
      error: "Paystack payment could not be applied.",
    };
  }
  return {
    status: "applied",
    invoiceNo: payload.invoice_no?.trim() || "",
    incomeIds: (payload.income_ids ?? []).filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
    alreadyApplied: payload.already_applied === true,
    appliedAmount: moneyFromRpc(payload.applied_amount),
    unallocatedAmount: moneyFromRpc(payload.unallocated_amount),
  };
}
