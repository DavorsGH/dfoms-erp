import "server-only";

/** Active SMS gateway — selected via SMS_PROVIDER (default hubtel). */
export type SmsProvider = "hubtel" | "formula_dc";

const DEFAULT_SMS_PROVIDER: SmsProvider = "hubtel";

/**
 * Resolve outbound SMS provider from SMS_PROVIDER.
 * Values: "hubtel" (default) | "formula_dc" (also accepts "formula-dc").
 */
export function resolveSmsProvider(): SmsProvider {
  const raw = (process.env.SMS_PROVIDER ?? DEFAULT_SMS_PROVIDER).trim().toLowerCase();
  if (raw === "formula_dc" || raw === "formula-dc") {
    return "formula_dc";
  }
  return DEFAULT_SMS_PROVIDER;
}
