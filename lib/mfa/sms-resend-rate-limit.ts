/**
 * Pure SMS resend gate logic (account-scoped rolling window + escalating backoff).
 * Exported for tests; Redis persistence lives in mfa-rate-limit.ts.
 */

/** Rolling window length for the total send cap. */
export const SMS_RESEND_WINDOW_MS = 15 * 60 * 1000;

/** Maximum SMS sends allowed within {@link SMS_RESEND_WINDOW_MS}. */
export const SMS_RESEND_MAX_SENDS = 5;

/**
 * Minutes that must elapse after send N before send N+1 is allowed.
 * Index 0 = after 1st send, before 2nd; index 3 = after 4th, before 5th.
 */
export const SMS_RESEND_BACKOFF_MINUTES = [1, 2, 5, 10] as const;

export type SmsResendGateResult =
  | { allowed: true }
  | {
      allowed: false;
      resendAvailableInSeconds: number;
      resendAvailableAtMs: number;
      blockReason: "cap" | "backoff";
    };

export function pruneSmsResendWindow(
  sends: number[],
  nowMs: number = Date.now(),
): number[] {
  const cutoff = nowMs - SMS_RESEND_WINDOW_MS;
  return sends.filter((timestamp) => timestamp > cutoff).sort((a, b) => a - b);
}

export function evaluateSmsResendGate(
  sends: number[],
  nowMs: number = Date.now(),
): SmsResendGateResult {
  const active = pruneSmsResendWindow(sends, nowMs);

  if (active.length >= SMS_RESEND_MAX_SENDS) {
    const windowResetMs = active[0]! + SMS_RESEND_WINDOW_MS;
    return {
      allowed: false,
      resendAvailableInSeconds: secondsUntil(windowResetMs, nowMs),
      resendAvailableAtMs: windowResetMs,
      blockReason: "cap",
    };
  }

  if (active.length === 0) {
    return { allowed: true };
  }

  const lastSendMs = active[active.length - 1]!;
  const backoffIndex = active.length - 1;
  const backoffMinutes = SMS_RESEND_BACKOFF_MINUTES[backoffIndex];

  if (backoffMinutes == null) {
    return { allowed: true };
  }

  const nextAllowedMs = lastSendMs + backoffMinutes * 60 * 1000;
  if (nowMs >= nextAllowedMs) {
    return { allowed: true };
  }

  return {
    allowed: false,
    resendAvailableInSeconds: secondsUntil(nextAllowedMs, nowMs),
    resendAvailableAtMs: nextAllowedMs,
    blockReason: "backoff",
  };
}

export function appendSmsResendSend(
  sends: number[],
  nowMs: number = Date.now(),
): number[] {
  return pruneSmsResendWindow([...sends, nowMs], nowMs);
}

function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 1000));
}

/** Human-readable schedule for ops/docs. */
export function describeSmsResendSchedule(): string {
  const lines = ["1st send: immediate (initial code)"];
  for (let i = 0; i < SMS_RESEND_BACKOFF_MINUTES.length; i++) {
    const minutes = SMS_RESEND_BACKOFF_MINUTES[i]!;
    lines.push(
      `Before ${i + 2}${ordinal(i + 2)} send: ${minutes} minute${minutes === 1 ? "" : "s"} since the ${i + 1}${ordinal(i + 1)}`,
    );
  }
  lines.push(
    `After ${SMS_RESEND_MAX_SENDS} sends within ${SMS_RESEND_WINDOW_MS / 60_000} minutes: blocked until the rolling window resets`,
  );
  return lines.join("\n");
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
