import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

type SubscriptionRow = {
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isTrialPeriodActive(trialEndDate: string | null): boolean {
  if (!trialEndDate) {
    return false;
  }

  return todayIsoDate() <= trialEndDate.slice(0, 10);
}

function subscriptionAllowsAccess(row: SubscriptionRow): boolean {
  const { subscription_status, trial_end_date } = row;

  if (subscription_status === "active") {
    return true;
  }

  if (subscription_status === "trialing") {
    return isTrialPeriodActive(trial_end_date);
  }

  return false;
}

/** Service-role lookup: crm_subscriptions lives under Davors tenant RLS. */
export const getLinkedTenantSubscription = cache(
  async (linkedTenantId: string): Promise<SubscriptionRow | null> => {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("crm_subscriptions")
      .select("subscription_status, trial_end_date")
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
 * Blocks dashboard access when a self-serve subscription exists and is not
 * active or in a valid trial. Skipped when no crm_subscriptions row exists
 * (e.g. Davors / Tenant 1). Only invoked from app/dashboard/layout.tsx.
 */
export async function ensureTrialAccess(): Promise<void> {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return;
  }

  const subscription = await getLinkedTenantSubscription(tenantId);
  if (!subscription) {
    return;
  }

  if (!subscriptionAllowsAccess(subscription)) {
    redirect("/trial-expired");
  }
}
