import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID, type CrmSubscriptionStatus } from "@/utils/tenant-signup";

export type TenantBillingSubscription = {
  subscriptionStatus: CrmSubscriptionStatus | null;
  trialEndDate: string | null;
  trialStartedAt: string | null;
  activatedAt: string | null;
  nextBillingDate: string | null;
  tierName: string | null;
  productId: string | null;
  paystackSubscriptionId: string | null;
  billingWaived: boolean;
  cancelledAt: string | null;
  cancellationReason: string | null;
};

type SubscriptionRecord = {
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
  created_at: string | null;
  activated_at: string | null;
  next_billing_date: string | null;
  product_id: string | null;
  paystack_subscription_id: string | null;
  billing_waived: boolean | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  product: { name: string } | { name: string }[] | null;
};

function productNameFromRow(
  product: SubscriptionRecord["product"],
): string | null {
  if (!product) {
    return null;
  }

  if (Array.isArray(product)) {
    return product[0]?.name ?? null;
  }

  return product.name ?? null;
}

export const getTenantBillingSubscription = cache(
  async (linkedTenantId: string): Promise<TenantBillingSubscription> => {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("crm_subscriptions")
      .select(
        "subscription_status, trial_end_date, created_at, activated_at, next_billing_date, product_id, paystack_subscription_id, billing_waived, cancelled_at, cancellation_reason, product:crm_products(name)",
      )
      .eq("linked_tenant_id", linkedTenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return {
        subscriptionStatus: null,
        trialEndDate: null,
        trialStartedAt: null,
        activatedAt: null,
        nextBillingDate: null,
        tierName: null,
        productId: null,
        paystackSubscriptionId: null,
        billingWaived: false,
        cancelledAt: null,
        cancellationReason: null,
      };
    }

    const row = data as SubscriptionRecord;

    return {
      subscriptionStatus: row.subscription_status,
      trialEndDate: row.trial_end_date,
      trialStartedAt:
        typeof row.created_at === "string" && row.created_at.trim()
          ? row.created_at.slice(0, 10)
          : null,
      activatedAt:
        typeof row.activated_at === "string" && row.activated_at.trim()
          ? row.activated_at
          : null,
      nextBillingDate: row.next_billing_date,
      tierName: productNameFromRow(row.product),
      productId: row.product_id,
      paystackSubscriptionId: row.paystack_subscription_id,
      billingWaived: row.billing_waived === true,
      cancelledAt: row.cancelled_at,
      cancellationReason: row.cancellation_reason,
    };
  },
);

/** Latest Paystack subscription code for a linked tenant's ERP subscription row. */
export async function getLinkedTenantPaystackSubscriptionCode(
  linkedTenantId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("crm_subscriptions")
    .select("paystack_subscription_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("linked_tenant_id", linkedTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const code = data?.paystack_subscription_id?.trim() ?? "";
  return code || null;
}
