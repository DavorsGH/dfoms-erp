import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { applyAccountCredit } from "@/utils/account-credit";
import { roundGhs } from "@/utils/product-sale-paystack";
import { fulfillSmsCreditPurchase } from "@/utils/sms-credit-paystack";

function creditOnlyReference(): string {
  return `CREDIT-SMS-${randomUUID()}`;
}

export async function fulfillSmsCreditPurchaseWithAccountCredit(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    purchaseRequestId: string;
    creditAppliedGhs: number;
  },
): Promise<{ reference: string; newCreditBalanceGhs: number; credits: number; balance: number | null }> {
  const creditApplied = roundGhs(input.creditAppliedGhs);
  if (!Number.isFinite(creditApplied) || creditApplied <= 0) {
    throw new Error("creditAppliedGhs must be positive for credit-only SMS purchase.");
  }

  const reference = creditOnlyReference();
  const newBalance = await applyAccountCredit(admin, {
    tenantId: input.tenantId,
    amountGhs: -creditApplied,
    reason: "sms_purchase",
    reference,
  });

  const { data: requestRow, error: requestError } = await admin
    .from("sms_credit_purchase_requests")
    .update({
      paystack_reference: reference,
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.purchaseRequestId)
    .eq("tenant_id", input.tenantId)
    .select("id")
    .single();

  if (requestError || !requestRow) {
    throw new Error(
      requestError?.message ?? "Failed to update SMS purchase request for credit-only flow.",
    );
  }

  const result = await fulfillSmsCreditPurchase(admin, {
    purchaseRequestId: input.purchaseRequestId,
    reference,
    paidAmountGhs: creditApplied,
    paidAt: new Date().toISOString(),
    metadataTenantId: input.tenantId,
  });

  return {
    reference,
    newCreditBalanceGhs: newBalance,
    credits: result.credits,
    balance: result.balance,
  };
}
