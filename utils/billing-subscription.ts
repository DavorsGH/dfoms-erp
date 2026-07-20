import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

export type TenantBillingSubscription = {
  subscriptionStatus: CrmSubscriptionStatus | null;
  trialEndDate: string | null;
  tierName: string | null;
  productId: string | null;
};

type SubscriptionRecord = {
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
  product_id: string | null;
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
        "subscription_status, trial_end_date, product_id, product:crm_products(name)",
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
        tierName: null,
        productId: null,
      };
    }

    const row = data as SubscriptionRecord;

    return {
      subscriptionStatus: row.subscription_status,
      trialEndDate: row.trial_end_date,
      tierName: productNameFromRow(row.product),
      productId: row.product_id,
    };
  },
);
