import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const SIGNUP_RATE_LIMIT_MESSAGE =
  "Too many signup attempts. Please try again in a few minutes.";

type SignupLimiters = {
  email: Ratelimit;
  ip: Ratelimit;
};

let limiters: SignupLimiters | null = null;

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getLimiters(): SignupLimiters | null {
  if (!isUpstashConfigured()) {
    return null;
  }

  if (!limiters) {
    const redis = Redis.fromEnv();
    limiters = {
      email: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "10 m"),
        prefix: "rl:signup:email",
        analytics: false,
      }),
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "10 m"),
        prefix: "rl:signup:ip",
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

/**
 * Peek remaining signup budget without consuming. Fail-open if Redis unavailable.
 */
export async function assertSignupAllowed(
  email: string,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const active = getLimiters();
  if (!active) {
    return { ok: true };
  }

  const emailKey = normalizeEmail(email);
  const ipKey = normalizeIp(ip);

  if (!emailKey) {
    return { ok: true };
  }

  try {
    const [emailBudget, ipBudget] = await Promise.all([
      active.email.getRemaining(emailKey),
      active.ip.getRemaining(ipKey),
    ]);

    if (emailBudget.remaining <= 0 || ipBudget.remaining <= 0) {
      return { ok: false, error: SIGNUP_RATE_LIMIT_MESSAGE };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      "[signup-rate-limit] pre-check failed; allowing attempt:",
      error instanceof Error ? error.message : error,
    );
    return { ok: true };
  }
}

/** Record a signup attempt against both email and IP budgets. */
export async function recordSignupAttempt(
  email: string,
  ip: string,
): Promise<void> {
  const active = getLimiters();
  if (!active) {
    return;
  }

  const emailKey = normalizeEmail(email);
  const ipKey = normalizeIp(ip);

  if (!emailKey) {
    return;
  }

  try {
    await Promise.all([
      active.email.limit(emailKey),
      active.ip.limit(ipKey),
    ]);
  } catch (error) {
    console.error(
      "[signup-rate-limit] failed to record attempt:",
      error instanceof Error ? error.message : error,
    );
  }
}

export { getRequestIp } from "@/utils/login-rate-limit";
