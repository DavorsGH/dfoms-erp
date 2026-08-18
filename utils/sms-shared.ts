import "server-only";

/** OTP/auth SMS always send. Everything else respects NON_OTP_SMS_ENABLED. */
export type SmsSendPurpose = "otp" | "transactional";

export type SendSmsResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string };

/**
 * Temporary kill switch during Hubtel → new provider migration.
 * Default false: non-OTP SMS short-circuit at the send wrapper (no provider call).
 * OTP/login/enrollment codes (purpose=otp) are always sent regardless.
 * Set NON_OTP_SMS_ENABLED=true to re-enable transactional SMS after migration.
 */
export function isNonOtpSmsSendingEnabled(): boolean {
  return (process.env["NON_OTP_SMS_ENABLED"] ?? "").trim().toLowerCase() === "true";
}
