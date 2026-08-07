import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const MFA_VERIFY_RATE_LIMIT_MESSAGE =
  "Too many verification attempts. Please try again in a few minutes.";

export const MFA_RESEND_RATE_LIMIT_MESSAGE =
  "Too many SMS requests. Please wait before requesting another code.";

type MfaLimiters = {
  verifyEmail: Ratelimit;
  verifyIp: Ratelimit;
  resendPhone: Ratelimit;
  resendIp: Ratelimit;
};

let limiters: MfaLimiters | null = null;

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getLimiters(): MfaLimiters | null {
  if (!isUpstashConfigured()) {
    return null;
  }

  if (!limiters) {
    const redis = Redis.fromEnv();
    limiters = {
      verifyEmail: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, "10 m"),
        prefix: "rl:mfa:verify:email",
        analytics: false,
      }),
      verifyIp: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "10 m"),
        prefix: "rl:mfa:verify:ip",
        analytics: false,
      }),
      resendPhone: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(3, "15 m"),
        prefix: "rl:mfa:resend:phone",
        analytics: false,
      }),
      resendIp: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(10, "15 m"),
        prefix: "rl:mfa:resend:ip",
        analytics: false,
      }),
    };
  }

  return limiters;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function assertMfaVerifyAllowed(
  email: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const active = getLimiters();
  if (!active) return { ok: true };

  const emailKey = normalizeEmail(email);
  const ipKey = normalizeIp(ip);
  if (!emailKey) return { ok: true };

  try {
    const [emailBudget, ipBudget] = await Promise.all([
      active.verifyEmail.getRemaining(emailKey),
      active.verifyIp.getRemaining(ipKey),
    ]);
    if (emailBudget.remaining <= 0 || ipBudget.remaining <= 0) {
      return { ok: false, error: MFA_VERIFY_RATE_LIMIT_MESSAGE };
    }
    return { ok: true };
  } catch (error) {
    console.error(
      "[mfa-rate-limit] verify pre-check failed; allowing:",
      error instanceof Error ? error.message : error,
    );
    return { ok: true };
  }
}

export async function recordFailedMfaVerifyAttempt(
  email: string,
  ip: string,
): Promise<void> {
  const active = getLimiters();
  if (!active) return;

  const emailKey = normalizeEmail(email);
  const ipKey = normalizeIp(ip);
  if (!emailKey) return;

  try {
    await Promise.all([
      active.verifyEmail.limit(emailKey),
      active.verifyIp.limit(ipKey),
    ]);
  } catch (error) {
    console.error(
      "[mfa-rate-limit] verify record failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

export async function assertMfaResendAllowed(
  phoneE164: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const active = getLimiters();
  if (!active) return { ok: true };

  const phoneKey = normalizePhone(phoneE164);
  const ipKey = normalizeIp(ip);
  if (!phoneKey) return { ok: true };

  try {
    const [phoneBudget, ipBudget] = await Promise.all([
      active.resendPhone.getRemaining(phoneKey),
      active.resendIp.getRemaining(ipKey),
    ]);
    if (phoneBudget.remaining <= 0 || ipBudget.remaining <= 0) {
      return { ok: false, error: MFA_RESEND_RATE_LIMIT_MESSAGE };
    }
    return { ok: true };
  } catch (error) {
    console.error(
      "[mfa-rate-limit] resend pre-check failed; allowing:",
      error instanceof Error ? error.message : error,
    );
    return { ok: true };
  }
}

export async function recordMfaResend(
  phoneE164: string,
  ip: string,
): Promise<void> {
  const active = getLimiters();
  if (!active) return;

  const phoneKey = normalizePhone(phoneE164);
  const ipKey = normalizeIp(ip);
  if (!phoneKey) return;

  try {
    await Promise.all([
      active.resendPhone.limit(phoneKey),
      active.resendIp.limit(ipKey),
    ]);
  } catch (error) {
    console.error(
      "[mfa-rate-limit] resend record failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
