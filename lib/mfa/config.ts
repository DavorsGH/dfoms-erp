/**
 * Read MFA_ENFORCEMENT at runtime using bracket access so Next.js 16 does not
 * inline the build-time value into Edge/Node bundles.
 */
export function readMfaEnforcementRaw(): string | undefined {
  return process.env["MFA_ENFORCEMENT"];
}

/** Sync check — safe for Edge Middleware (no connection() available). */
export function isMfaEnforcementEnabled(): boolean {
  return readMfaEnforcementRaw() === "true";
}

/**
 * Server-side check — opts into dynamic rendering so env is read at request
 * time on Vercel Node (Next.js 16 inlines static process.env.* at build).
 */
export async function isMfaEnforcementEnabledAtRuntime(): Promise<boolean> {
  const { connection } = await import("next/server");
  await connection();
  return readMfaEnforcementRaw() === "true";
}

export function getMfaEnforcementEnvDebug(): {
  raw: string | undefined;
  enabled: boolean;
} {
  const raw = readMfaEnforcementRaw();
  return {
    raw,
    enabled: raw === "true",
  };
}

/**
 * Emergency bypass when SMS OTP delivery is unavailable (e.g. Hubtel outage).
 * When true, accounts with method=sms can log in with password only; stored
 * preference is unchanged. TOTP and method=none are unaffected.
 *
 * Set MFA_SMS_LOGIN_BYPASS=true on Vercel, redeploy, then revert when SMS works.
 */
export function readMfaSmsLoginBypassRaw(): string | undefined {
  return process.env["MFA_SMS_LOGIN_BYPASS"];
}

/** Sync — safe for Edge Middleware. */
export function isMfaSmsLoginBypassEnabled(): boolean {
  return readMfaSmsLoginBypassRaw() === "true";
}

export async function isMfaSmsLoginBypassEnabledAtRuntime(): Promise<boolean> {
  const { connection } = await import("next/server");
  await connection();
  return readMfaSmsLoginBypassRaw() === "true";
}
