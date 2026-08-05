import type { LandlordSubscriptionStatus } from "@/app/dashboard/real-estate/landlords-utils";

export type PlatformOnlyLandlordSubscriptionAccessRow = {
  status: LandlordSubscriptionStatus | null;
  trial_ends_at: string | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isTrialPeriodActive(trialEndsAt: string | null): boolean {
  if (!trialEndsAt) {
    return false;
  }
  return todayIsoDate() <= trialEndsAt.slice(0, 10);
}

/**
 * Shared access predicate for platform_only landlord unit billing subscriptions.
 * Mirrors ERP Suite grace in subscription-access.ts: past_due retains full access.
 */
export function platformOnlyLandlordSubscriptionAllowsAccess(
  row: PlatformOnlyLandlordSubscriptionAccessRow | null | undefined,
): boolean {
  if (!row?.status) {
    return true;
  }

  const { status, trial_ends_at: trialEndsAt } = row;

  if (status === "active") {
    return true;
  }

  // past_due: failed monthly charge — keep portal + active units accessible.
  if (status === "past_due") {
    return true;
  }

  if (status === "trialing") {
    return isTrialPeriodActive(trialEndsAt);
  }

  if (status === "cancelled") {
    return false;
  }

  return false;
}
