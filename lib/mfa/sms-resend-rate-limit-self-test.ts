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
  authUid: string;
  steps: SmsResendPolicyCheckStep[];
};

function step(
  name: string,
  pass: boolean,
  detail: string,
): SmsResendPolicyCheckStep {
  return { name, pass, detail };
}

export async function runSmsResendPolicySelfTest(): Promise<SmsResendPolicyCheckResult> {
  const steps: SmsResendPolicyCheckStep[] = [];
  const authUid = `policy-check-${randomUUID()}`;

  await resetMfaResendStateForAccount(authUid);

  let allowed = await assertMfaResendAllowed(authUid);
  steps.push(
    step(
      "send-1-allowed",
      allowed.ok === true,
      allowed.ok ? "first send allowed" : "first send blocked unexpectedly",
    ),
  );
  await recordMfaResend(authUid);

  const backoffChecks = [
    { send: 2, minSeconds: 55, maxSeconds: 60, label: "1 minute" },
    { send: 3, minSeconds: 115, maxSeconds: 120, label: "2 minutes" },
    { send: 4, minSeconds: 295, maxSeconds: 300, label: "5 minutes" },
    { send: 5, minSeconds: 595, maxSeconds: 600, label: "10 minutes" },
  ] as const;

  for (const check of backoffChecks) {
    allowed = await assertMfaResendAllowed(authUid);
    const earlyBlocked = !allowed.ok;
    let earlyDetail = "not blocked";
    if (!allowed.ok) {
      earlyDetail = `${allowed.resendAvailableInSeconds}s → ${formatSmsResendRateLimitMessage(allowed.resendAvailableInSeconds)}`;
    }
    steps.push(
      step(
        `send-${check.send}-early-block`,
        earlyBlocked &&
          allowed.ok === false &&
          allowed.resendAvailableInSeconds >= check.minSeconds &&
          allowed.resendAvailableInSeconds <= check.maxSeconds,
        earlyDetail,
      ),
    );

    const { Redis } = await import("@upstash/redis");
    const redis = Redis.fromEnv();
    const raw = await redis.get<{ sends: number[] }>(smsResendRedisKey(authUid));
    const sends = raw?.sends ?? [];
    const backoffMinutes = SMS_RESEND_BACKOFF_MINUTES[sends.length - 1] ?? 0;
    const shifted = sends.map((timestamp, index) =>
      index === sends.length - 1
        ? Date.now() - backoffMinutes * 60_000 - 500
        : timestamp,
    );
    await redis.set(smsResendRedisKey(authUid), { sends: shifted }, { ex: 960 });

    allowed = await assertMfaResendAllowed(authUid);
    steps.push(
      step(
        `send-${check.send}-after-backoff`,
        allowed.ok === true,
        allowed.ok ? `allowed after ${check.label}` : "still blocked",
      ),
    );
    await recordMfaResend(authUid);
  }

  await resetMfaResendStateForAccount(authUid);
  const now = Date.now();
  const packedSends = [
    now - 14 * 60_000,
    now - 13 * 60_000,
    now - 12 * 60_000,
    now - 11 * 60_000,
    now - 10 * 60_000,
  ];
  const { Redis } = await import("@upstash/redis");
  const redis = Redis.fromEnv();
  await redis.set(smsResendRedisKey(authUid), { sends: packedSends }, { ex: 960 });

  const capGate = evaluateSmsResendGate(packedSends, now);
  allowed = await assertMfaResendAllowed(authUid);
  steps.push(
    step(
      "cap-blocks-6th",
      capGate.allowed === false &&
        capGate.blockReason === "cap" &&
        allowed.ok === false,
      allowed.ok
        ? "6th unexpectedly allowed"
        : `${allowed.resendAvailableInSeconds}s → ${formatSmsResendRateLimitMessage(allowed.resendAvailableInSeconds)}`,
    ),
  );

  await resetMfaResendStateForAccount(authUid);

  return {
    ok: steps.every((entry) => entry.pass),
    schedule: describeSmsResendSchedule(),
    authUid,
    steps,
  };
}
