import { randomUUID } from "node:crypto";
import { formatSmsResendRateLimitMessage } from "./format-sms-resend-wait";
import {
  evaluateSmsResendGate,
  SMS_RESEND_BACKOFF_MINUTES,
  describeSmsResendSchedule,
} from "./sms-resend-rate-limit";
import {
  assertMfaResendAllowed,
  recordMfaResend,
  resetMfaResendStateForAccount,
  smsResendRedisKey,
} from "./sms-resend-rate-limit-store";

export type SmsResendPolicyCheckStep = {
  name: string;
  pass: boolean;
  detail: string;
};

export type SmsResendPolicyCheckResult = {
  ok: boolean;
  schedule: string;
  steps: SmsResendPolicyCheckStep[];
};

function step(
  name: string,
  pass: boolean,
  detail: string,
): SmsResendPolicyCheckStep {
  return { name, pass, detail };
}

async function withFreshAccount(
  fn: (authUid: string) => Promise<SmsResendPolicyCheckStep>,
): Promise<SmsResendPolicyCheckStep> {
  const authUid = `policy-check-${randomUUID()}`;
  await resetMfaResendStateForAccount(authUid);
  try {
    return await fn(authUid);
  } finally {
    await resetMfaResendStateForAccount(authUid);
  }
}

export async function runSmsResendPolicySelfTest(): Promise<SmsResendPolicyCheckResult> {
  const steps: SmsResendPolicyCheckStep[] = [];

  steps.push(
    await withFreshAccount(async (authUid) => {
      const allowed = await assertMfaResendAllowed(authUid);
      return step(
        "send-1-allowed",
        allowed.ok === true,
        allowed.ok ? "first send allowed" : "first send blocked unexpectedly",
      );
    }),
  );

  const earlyChecks = [
    { name: "send-2-early-block", priorSends: 1, minSeconds: 55, maxSeconds: 60, label: "1 minute" },
    { name: "send-3-early-block", priorSends: 2, minSeconds: 115, maxSeconds: 120, label: "2 minutes" },
    { name: "send-4-early-block", priorSends: 3, minSeconds: 295, maxSeconds: 300, label: "5 minutes" },
    { name: "send-5-early-block", priorSends: 4, minSeconds: 595, maxSeconds: 600, label: "10 minutes" },
  ] as const;

  for (const check of earlyChecks) {
    steps.push(
      await withFreshAccount(async (authUid) => {
        const now = Date.now();
        const sends: number[] = [];
        for (let i = 0; i < check.priorSends; i++) {
          if (i === check.priorSends - 1) {
            sends.push(now);
          } else {
            sends.push(now - (check.priorSends - i) * 60_000);
          }
        }

        const { Redis } = await import("@upstash/redis");
        const redis = Redis.fromEnv();
        await redis.set(smsResendRedisKey(authUid), { sends }, { ex: 960 });

        const allowed = await assertMfaResendAllowed(authUid);
        if (!allowed.ok) {
          const msg = formatSmsResendRateLimitMessage(allowed.resendAvailableInSeconds);
          return step(
            check.name,
            allowed.resendAvailableInSeconds >= check.minSeconds &&
              allowed.resendAvailableInSeconds <= check.maxSeconds,
            `${allowed.resendAvailableInSeconds}s → ${msg}`,
          );
        }

        return step(check.name, false, "expected block but send was allowed");
      }),
    );
  }

  steps.push(
    await withFreshAccount(async (authUid) => {
      const now = Date.now();
      const packedSends = [
        now - 13 * 60_000,
        now - 12 * 60_000,
        now - 11 * 60_000,
        now - 10 * 60_000,
        now - 9 * 60_000,
      ];

      const { Redis } = await import("@upstash/redis");
      const redis = Redis.fromEnv();
      await redis.set(smsResendRedisKey(authUid), { sends: packedSends }, { ex: 960 });

      const capGate = evaluateSmsResendGate(packedSends, now);
      const allowed = await assertMfaResendAllowed(authUid);
      if (!allowed.ok) {
        const msg = formatSmsResendRateLimitMessage(allowed.resendAvailableInSeconds);
        return step(
          "cap-blocks-6th",
          capGate.allowed === false &&
            capGate.blockReason === "cap" &&
            allowed.resendAvailableInSeconds > 60,
          `${allowed.resendAvailableInSeconds}s → ${msg}`,
        );
      }

      return step("cap-blocks-6th", false, "6th send allowed despite 5 in window");
    }),
  );

  steps.push(
    await withFreshAccount(async (authUid) => {
      const now = Date.now();
      const packedSends = [
        now - 14 * 60_000,
        now - 13 * 60_000,
        now - 12 * 60_000,
        now - 11 * 60_000,
        now - (10 * 60_000 + 30_000),
      ];

      const { Redis } = await import("@upstash/redis");
      const redis = Redis.fromEnv();
      await redis.set(smsResendRedisKey(authUid), { sends: packedSends }, { ex: 960 });

      const gate = evaluateSmsResendGate(packedSends, now);
      if (gate.allowed || gate.blockReason !== "cap") {
        return step("cap-overrides-backoff", false, "expected cap gate");
      }

      const lastSend = packedSends[packedSends.length - 1]!;
      const backoffMinutes = SMS_RESEND_BACKOFF_MINUTES[packedSends.length - 1] ?? 0;
      const backoffElapsed =
        now - lastSend >= backoffMinutes * 60_000;

      return step(
        "cap-overrides-backoff",
        backoffElapsed && gate.resendAvailableInSeconds > 60,
        backoffElapsed
          ? `backoff elapsed but cap still blocks for ${gate.resendAvailableInSeconds}s`
          : "backoff not elapsed in fixture",
      );
    }),
  );

  return {
    ok: steps.every((entry) => entry.pass),
    schedule: describeSmsResendSchedule(),
    steps,
  };
}
