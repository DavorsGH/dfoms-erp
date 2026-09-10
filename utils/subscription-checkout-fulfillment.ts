import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { applyAccountCredit } from "@/utils/account-credit";
import { notifySubscriptionConvertedToPaid } from "@/utils/admin-notifications";
import { maybeQualifyReferralOnFirstSubscriptionPayment } from "@/utils/referral-qualification";
import { roundGhs } from "@/utils/product-sale-paystack";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";
import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

type SubscriptionActivationRow = {
  id: string;
  linked_tenant_id: string | null;
  product_id: string | null;
  subscription_status: CrmSubscriptionStatus;
  activated_at: string | null;
  billing_waived: boolean | null;
};

const SUBSCRIPTION_ACTIVATION_SELECT =
  "id, linked_tenant_id, product_id, subscription_status, activated_at, billing_waived";

function creditOnlyReference(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function activateSubscriptionAfterPayment(
  admin: SupabaseClient,
  input: {
    linkedTenantId: string;
    productId: string;
    listPriceGhs: number;
  },
): Promise<
  SubscriptionActivationRow & {
    previousStatus: CrmSubscriptionStatus;
    hadActivatedAt: boolean;
  }
> {
  const { data: row, error: loadError } = await admin
    .from("crm_subscriptions")
    .select(SUBSCRIPTION_ACTIVATION_SELECT)
    .eq("linked_tenant_id", input.linkedTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (!row?.id) {
    throw new Error("No subscription record exists for this tenant.");
  }

  const previousStatus = row.subscription_status as CrmSubscriptionStatus;
  const patch: Record<string, unknown> = {
    subscription_status: "active",
    product_id: input.productId,
    cancellation_reason: null,
    cancellation_reason_detail: null,
    cancelled_at: null,
  };

  if (previousStatus === "trialing" && !row.activated_at) {
    patch.activated_at = new Date().toISOString();
  }

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update(patch)
    .eq("id", row.id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  if (previousStatus === "trialing" && !row.activated_at) {
    const [tenantName, productResult] = await Promise.all([
      resolveTenantDisplayName(admin, input.linkedTenantId),
      admin
        .from("crm_products")
        .select("name")
        .eq("id", input.productId)
        .maybeSingle(),
    ]);

    await notifySubscriptionConvertedToPaid({
      tenantName,
      tierName: productResult.data?.name?.trim() ?? null,
      amountLabel: `GHS ${roundGhs(input.listPriceGhs).toFixed(2)}`,
    }).catch(() => undefined);
  }

  return {
    ...(row as SubscriptionActivationRow),
    previousStatus,
    hadActivatedAt: Boolean(row.activated_at),
  };
}

export async function fulfillSubscriptionCheckoutWithAccountCredit(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    productId: string;
    listPriceGhs: number;
    creditAppliedGhs: number;
  },
): Promise<{ reference: string; newCreditBalanceGhs: number }> {
  const creditApplied = roundGhs(input.creditAppliedGhs);
  if (!Number.isFinite(creditApplied) || creditApplied <= 0) {
    throw new Error("creditAppliedGhs must be positive for credit-only checkout.");
  }

  const reference = creditOnlyReference("CREDIT-SUB");
  const newBalance = await applyAccountCredit(admin, {
    tenantId: input.tenantId,
    amountGhs: -creditApplied,
    reason: "subscription_payment",
    reference,
  });

  const activated = await activateSubscriptionAfterPayment(admin, {
    linkedTenantId: input.tenantId,
    productId: input.productId,
    listPriceGhs: input.listPriceGhs,
  });

  const wasFirstPaidActivation =
    activated.previousStatus === "trialing" && !activated.hadActivatedAt;

  console.log(
    `[subscription-checkout-fulfillment] referral qualification check linked_tenant_id=${input.tenantId} ref=${reference} wasFirstPaidActivation=${wasFirstPaidActivation}`,
  );
  await maybeQualifyReferralOnFirstSubscriptionPayment(admin, {
    linkedTenantId: input.tenantId,
    reference,
    wasFirstPaidActivation,
  }).catch((error) => {
    console.error(
      "[subscription-checkout-fulfillment] referral qualification failed:",
      error instanceof Error ? error.message : error,
    );
  });

  return { reference, newCreditBalanceGhs: newBalance };
}

export async function deductPartialSubscriptionCredit(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    creditAppliedGhs: number;
    paystackReference: string;
  },
): Promise<number> {
  const creditApplied = roundGhs(input.creditAppliedGhs);
  if (!Number.isFinite(creditApplied) || creditApplied <= 0) {
    throw new Error("creditAppliedGhs must be positive.");
  }

  return applyAccountCredit(admin, {
    tenantId: input.tenantId,
    amountGhs: -creditApplied,
    reason: "subscription_payment",
    reference: input.paystackReference,
  });
}
