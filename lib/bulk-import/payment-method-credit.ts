export function normalizePaymentMethod(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-");
}

/** Mirrors fixed-assets / expense-register cash vs on-account split using payment method naming. */
export function isCreditPaymentMethod(
  paymentMethod: string | null | undefined,
): boolean {
  const normalized = normalizePaymentMethod(paymentMethod);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("credit") ||
    normalized.includes("on account") ||
    normalized.includes("on-account") ||
    normalized.includes("accounts payable") ||
    normalized.includes("supplier credit")
  );
}
