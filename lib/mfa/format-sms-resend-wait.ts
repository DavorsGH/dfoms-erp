import type { MfaActionResult } from "./types";

export function formatSmsResendRateLimitMessage(
  resendAvailableInSeconds: number,
): string {
  if (resendAvailableInSeconds < 60) {
    const seconds = Math.max(1, Math.ceil(resendAvailableInSeconds));
    return seconds === 1
      ? "Too many SMS requests. Try again in 1 second."
      : `Too many SMS requests. Try again in ${seconds} seconds.`;
  }

  const minutes = Math.round(resendAvailableInSeconds / 60);
  return minutes === 1
    ? "Too many SMS requests. Try again in 1 minute."
    : `Too many SMS requests. Try again in ${minutes} minutes.`;
}

export function formatSmsResendCountdownClock(remainingSeconds: number): string {
  const total = Math.max(0, Math.ceil(remainingSeconds));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatSmsResendRateLimitLiveMessage(
  remainingSeconds: number,
): string {
  return `Too many SMS requests. Try again in ${formatSmsResendCountdownClock(remainingSeconds)}.`;
}

export function isSmsResendRateLimited(
  result: MfaActionResult,
): result is {
  ok: false;
  error: string;
  resendAvailableAtMs: number;
  resendAvailableInSeconds?: number;
} {
  return (
    !result.ok &&
    result.resendAvailableAtMs != null &&
    Number.isFinite(result.resendAvailableAtMs)
  );
}

export function formatMfaActionError(result: {
  ok: false;
  error: string;
  resendAvailableInSeconds?: number;
}): string {
  if (
    result.resendAvailableInSeconds != null &&
    result.resendAvailableInSeconds > 0
  ) {
    return formatSmsResendRateLimitMessage(result.resendAvailableInSeconds);
  }

  return result.error;
}
