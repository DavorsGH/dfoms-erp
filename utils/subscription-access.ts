import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

export type SubscriptionAccessRow = {
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
  billing_waived: boolean | null;
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

/**
 * Shared access predicate used by ensureTrialAccess(). Kept free of server-only
 * so staging scripts can import/verify the same rules as the dashboard gate.
 */
export function subscriptionAllowsAccess(row: SubscriptionAccessRow): boolean {
  // Billing waiver is checked first — comps grant full access regardless of
  // trial dates or subscription_status.
  if (row.billing_waived === true) {
    return true;
  }

  const { subscription_status, trial_end_date } = row;

  if (subscription_status === "active") {
    return true;
  }

  // past_due: flagged by invoice.payment_failed webhook — keep access (grace)
  // until we later move the tenant to restricted/cancelled.
  if (subscription_status === "past_due") {
    return true;
  }

  if (subscription_status === "trialing") {
    return isTrialPeriodActive(trial_end_date);
  }

  return false;
}
