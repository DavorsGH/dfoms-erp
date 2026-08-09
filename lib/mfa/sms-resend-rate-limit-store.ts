import { Redis } from "@upstash/redis";
import {
  appendSmsResendSend,
  evaluateSmsResendGate,
  pruneSmsResendWindow,
  SMS_RESEND_WINDOW_MS,
} from "./sms-resend-rate-limit";

export const MFA_RESEND_RATE_LIMIT_MESSAGE =
  "Too many SMS requests. Please wait before requesting another code.";

type SmsResendAccountState = {
  sends: number[];
};

let redisClient: Redis | null = null;

export const SMS_RESEND_REDIS_PREFIX = "rl:mfa:sms-resend:account";

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

export function smsResendRedisKey(authUid: string): string {
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
      sends: (raw as SmsResendAccountState).sends
        .map((value: unknown) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            return value;
          }
          if (typeof value === "string" && value.trim().length > 0) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          }
          return null;
        })
        .filter((value): value is number => value != null),
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

export async function assertMfaResendAllowed(
  authUid: string,
): Promise<
  | { ok: true }
  | {
      ok: false;
      error: string;
      resendAvailableInSeconds: number;
      resendAvailableAtMs: number;
    }
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
        resendAvailableAtMs: gate.resendAvailableAtMs,
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
