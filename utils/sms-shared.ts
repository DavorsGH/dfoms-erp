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

const DEFAULT_SMS_TENANT_LABEL = "Davors Facilities";
const DEFAULT_SMS_RECIPIENT_LABEL = "Customer";

/**
 * Prefix transactional SMS with shared-sender tenant/recipient context.
 * OTP messages must not use this helper (see sendHubtelSms purpose gate).
 */
export function formatTransactionalSmsBody(options: {
  tenantName?: string | null;
  recipientName?: string | null;
  body: string;
}): string {
  const rawTenant = options.tenantName?.trim();
  const rawRecipient = options.recipientName?.trim();
  const tenant = rawTenant || DEFAULT_SMS_TENANT_LABEL;
  const recipient = rawRecipient || DEFAULT_SMS_RECIPIENT_LABEL;

  if (!rawTenant) {
    console.warn(
      `[sms-shared] formatTransactionalSmsBody: missing tenantName; using fallback "${DEFAULT_SMS_TENANT_LABEL}".`,
    );
  }
  if (!rawRecipient) {
    console.warn(
      `[sms-shared] formatTransactionalSmsBody: missing recipientName; using fallback "${DEFAULT_SMS_RECIPIENT_LABEL}".`,
    );
  }

  return `From: ${tenant}\nTo: ${recipient}\n${options.body.trim()}`;
}
