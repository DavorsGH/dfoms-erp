import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { getTenantStatus } from "@/utils/tenant-management";
import {
  subscriptionAllowsAccess,
  type SubscriptionAccessRow,
} from "@/utils/subscription-access";

/** Service-role lookup: crm_subscriptions lives under Davors tenant RLS. */
export const getLinkedTenantSubscription = cache(
  async (linkedTenantId: string): Promise<SubscriptionAccessRow | null> => {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("crm_subscriptions")
      .select("subscription_status, trial_end_date, billing_waived")
      .eq("linked_tenant_id", linkedTenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data;
  },
);

/**
 * Blocks dashboard access when the tenant is suspended, or when a self-serve
 * subscription exists and is not active or in a valid trial. Skipped when no
 * crm_subscriptions row exists (e.g. Davors / Tenant 1). Only invoked from
 * app/dashboard/layout.tsx.
 */
export async function ensureTrialAccess(): Promise<void> {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return;
  }

  const tenantStatus = await getTenantStatus(tenantId);
  if (tenantStatus === "suspended") {
    redirect("/account-suspended");
  }

  const subscription = await getLinkedTenantSubscription(tenantId);
  if (!subscription) {
    return;
  }

  if (!subscriptionAllowsAccess(subscription)) {
    redirect("/trial-expired");
  }
}

export { subscriptionAllowsAccess };
