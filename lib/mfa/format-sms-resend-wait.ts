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
