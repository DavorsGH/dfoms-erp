import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export const LOGIN_RATE_LIMIT_MESSAGE =
  "Too many login attempts. Please try again in a few minutes.";

type LoginLimiters = {
  email: Ratelimit;
  ip: Ratelimit;
};

let limiters: LoginLimiters | null = null;

function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getLimiters(): LoginLimiters | null {
  if (!isUpstashConfigured()) {
    return null;
  }

  if (!limiters) {
    const redis = Redis.fromEnv();
    limiters = {
      email: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "10 m"),
        prefix: "rl:login:email",
        analytics: false,
      }),
      ip: new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(20, "10 m"),
        prefix: "rl:login:ip",
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
 * Peek remaining budget without consuming. Call before Supabase Auth.
 * Fail-open if Upstash is not configured or Redis errors (login still works).
 */
export async function assertLoginAllowed(
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
      return { ok: false, error: LOGIN_RATE_LIMIT_MESSAGE };
    }

    return { ok: true };
  } catch (error) {
    console.error(
      "[login-rate-limit] pre-check failed; allowing attempt:",
      error instanceof Error ? error.message : error,
    );
    return { ok: true };
  }
}

/**
 * Record a failed login against both email and IP budgets.
 * Successful logins must not call this.
 */
export async function recordFailedLoginAttempt(
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
      "[login-rate-limit] failed to record attempt:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Best-effort client IP from proxy headers (Vercel / common reverse proxies). */
export function getRequestIp(headerStore: Headers): string {
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return (
    headerStore.get("x-real-ip")?.trim() ||
    headerStore.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}
