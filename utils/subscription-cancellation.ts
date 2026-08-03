export const SUBSCRIPTION_CANCELLATION_REASONS = [
  { value: "too_expensive", label: "Too expensive" },
  { value: "missing_features", label: "Missing features" },
  { value: "switching_tool", label: "Switching to another tool" },
  { value: "no_longer_needed", label: "No longer needed" },
  { value: "other", label: "Other" },
] as const;

export type SubscriptionCancellationReason =
  (typeof SUBSCRIPTION_CANCELLATION_REASONS)[number]["value"];

const REASON_SET = new Set<string>(
  SUBSCRIPTION_CANCELLATION_REASONS.map((option) => option.value),
);

export function isSubscriptionCancellationReason(
  value: string,
): value is SubscriptionCancellationReason {
  return REASON_SET.has(value);
}

export function formatSubscriptionCancellationReason(
  value: string | null | undefined,
  detail: string | null | undefined = null,
): string {
  if (!value) {
    return "—";
  }
  const match = SUBSCRIPTION_CANCELLATION_REASONS.find(
    (option) => option.value === value,
  );
  if (value === "other" && detail?.trim()) {
    return detail.trim();
  }
  return match?.label ?? value.replace(/_/g, " ");
}

export function formatSubscriptionAccessEndDate(
  value: string | null | undefined,
): string {
  if (!value) {
    return "the end of your current billing period";
  }
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
