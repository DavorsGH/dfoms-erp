import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import {
  appendSmsResendSend,
  evaluateSmsResendGate,
  pruneSmsResendWindow,
  SMS_RESEND_WINDOW_MS,
} from "./sms-resend-rate-limit";

export {
  describeSmsResendSchedule,
  SMS_RESEND_BACKOFF_MINUTES,
  SMS_RESEND_MAX_SENDS,
  SMS_RESEND_WINDOW_MS,
} from "./sms-resend-rate-limit";

export const MFA_VERIFY_RATE_LIMIT_MESSAGE =
  "Too many verification attempts. Please try again in a few minutes.";

export const MFA_RESEND_RATE_LIMIT_MESSAGE =
  "Too many SMS requests. Please wait before requesting another code.";

type MfaVerifyLimiters = {
  verifyEmail: Ratelimit;
  verifyIp: Ratelimit;
};

type SmsResendAccountState = {
  sends: number[];
};

let verifyLimiters: MfaVerifyLimiters | null = null;
let redisClient: Redis | null = null;

const SMS_RESEND_REDIS_PREFIX = "rl:mfa:sms-resend:account";

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

function smsResendRedisKey(authUid: string): string {
  return `${SMS_RESEND_REDIS_PREFIX}:${authUid}`;
}

function normalizeSmsResendState(raw: unknown): SmsResendAccountState {
  if (
    raw &&
    typeof raw === "object" &&
    "sends" in raw &&
    Array.isArray((raw as SmsResendAccountState).sends)
  ) {
    return {
      sends: (raw as SmsResendAccountState).sends.filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
      ),
    };
  }

  return { sends: [] };
}

async function loadSmsResendState(authUid: string): Promise<SmsResendAccountState> {
  const redis = getRedis();
  if (!redis) {
    return { sends: [] };
  }

  const raw = await redis.get<SmsResendAccountState>(smsResendRedisKey(authUid));
  const state = normalizeSmsResendState(raw);
  return { sends: pruneSmsResendWindow(state.sends) };
}

async function saveSmsResendState(
  authUid: string,
  state: SmsResendAccountState,
): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    return;
  }

  const pruned = pruneSmsResendWindow(state.sends);
  const ttlSeconds = Math.ceil(SMS_RESEND_WINDOW_MS / 1000) + 60;

  if (pruned.length === 0) {
    await redis.del(smsResendRedisKey(authUid));
    return;
  }

  await redis.set(smsResendRedisKey(authUid), { sends: pruned }, { ex: ttlSeconds });
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

export async function assertMfaResendAllowed(
  authUid: string,
): Promise<
  { ok: true } | { ok: false; error: string; resendAvailableInSeconds: number }
> {
  if (!authUid.trim()) return { ok: true };

  try {
    const state = await loadSmsResendState(authUid);
    const gate = evaluateSmsResendGate(state.sends);

    if (!gate.allowed) {
      return {
        ok: false,
        error: MFA_RESEND_RATE_LIMIT_MESSAGE,
        resendAvailableInSeconds: gate.resendAvailableInSeconds,
      };
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

export async function recordMfaResend(authUid: string): Promise<void> {
  if (!authUid.trim()) return;

  try {
    const state = await loadSmsResendState(authUid);
    const updated = appendSmsResendSend(state.sends);
    await saveSmsResendState(authUid, { sends: updated });
  } catch (error) {
    console.error(
      "[mfa-rate-limit] resend record failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/** Staging/test helper — clears account SMS resend state in Redis. */
export async function resetMfaResendStateForAccount(authUid: string): Promise<void> {
  const redis = getRedis();
  if (!redis || !authUid.trim()) return;
  await redis.del(smsResendRedisKey(authUid));
}
