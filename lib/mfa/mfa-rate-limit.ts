import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export {
  describeSmsResendSchedule,
  SMS_RESEND_BACKOFF_MINUTES,
  SMS_RESEND_MAX_SENDS,
  SMS_RESEND_WINDOW_MS,
} from "./sms-resend-rate-limit";

export {
  assertMfaResendAllowed,
  MFA_RESEND_RATE_LIMIT_MESSAGE,
  recordMfaResend,
  resetMfaResendStateForAccount,
} from "./sms-resend-rate-limit-store";

export const MFA_VERIFY_RATE_LIMIT_MESSAGE =
  "Too many verification attempts. Please try again in a few minutes.";

type MfaVerifyLimiters = {
  verifyEmail: Ratelimit;
  verifyIp: Ratelimit;
};

let verifyLimiters: MfaVerifyLimiters | null = null;
let redisClient: Redis | null = null;

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getRedis(): Redis | null {
  if (!isUpstashConfigured()) {
    return null;
  }

  if (!redisClient) {
    redisClient = Redis.fromEnv();
  }

  return redisClient;
}

function getVerifyLimiters(): MfaVerifyLimiters | null {
  if (!isUpstashConfigured()) {
    return null;
  }

  if (!verifyLimiters) {
    const redis = getRedis()!;
    verifyLimiters = {
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
    };
  }

  return verifyLimiters;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

export async function assertMfaVerifyAllowed(
  email: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const active = getVerifyLimiters();
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
  const active = getVerifyLimiters();
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
