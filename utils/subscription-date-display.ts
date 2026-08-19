export function addCalendarDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * landlord_subscriptions has no created_at in schema — while trialing use
 * current_period_start (seeded at approval); after conversion derive from
 * trial_ends_at and the platform trial length constant used at signup.
 */
export function resolveLandlordTrialStartedIsoDate(options: {
  status: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  trialLengthDays: number;
}): string | null {
  const periodStart = options.currentPeriodStart?.slice(0, 10) ?? null;
  const trialEndsAt = options.trialEndsAt?.slice(0, 10) ?? null;

  if (options.status === "trialing" && periodStart) {
    return periodStart;
  }
  if (trialEndsAt) {
    return addCalendarDaysIso(trialEndsAt, -options.trialLengthDays);
  }

  return null;
}

/** Whole calendar days from fromIsoDate (default today UTC) until isoEndDate. */
export function calendarDaysUntilIsoDate(
  isoEndDate: string,
  fromIsoDate?: string,
): number {
  const from = (fromIsoDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const end = isoEndDate.slice(0, 10);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  return Math.round((endMs - fromMs) / 86_400_000);
}

/** e.g. "14 days left in your free trial, ends 12 Sept 2026" */
export function formatTrialCountdownMessage(
  trialEndIsoDate: string,
  formattedEndDate: string,
): string {
  const days = calendarDaysUntilIsoDate(trialEndIsoDate);
  if (days < 0) {
    return `Free trial ended ${formattedEndDate}`;
  }
  const dayLabel = days === 1 ? "1 day" : `${days} days`;
  return `${dayLabel} left in your free trial, ends ${formattedEndDate}`;
}
