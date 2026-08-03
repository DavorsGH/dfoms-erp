import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

export type SubscriptionAccessRow = {
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
  next_billing_date: string | null;
  billing_waived: boolean | null;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDateOnOrAfterToday(isoDate: string | null | undefined): boolean {
  if (!isoDate) {
    return false;
  }
  return todayIsoDate() <= isoDate.slice(0, 10);
}

function isTrialPeriodActive(trialEndDate: string | null): boolean {
  if (!trialEndDate) {
    return false;
  }

  return isDateOnOrAfterToday(trialEndDate);
}

/** Paid period end for cancelled subs (next_billing_date = current period end). */
export function subscriptionCancelledAccessActive(
  row: Pick<SubscriptionAccessRow, "subscription_status" | "next_billing_date">,
): boolean {
  return (
    row.subscription_status === "cancelled" &&
    isDateOnOrAfterToday(row.next_billing_date)
  );
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

  const { subscription_status, trial_end_date, next_billing_date } = row;

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

  // Cancelled: retain access until next_billing_date (paid period end). Paystack
  // stops future charges immediately; dashboard gate honours the prepaid window.
  if (subscription_status === "cancelled") {
    return isDateOnOrAfterToday(row.next_billing_date);
  }

  return false;
}
