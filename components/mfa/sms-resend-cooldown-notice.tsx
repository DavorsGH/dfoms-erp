"use client";

import { formatSmsResendRateLimitLiveMessage } from "@/lib/mfa/format-sms-resend-wait";

type Props = {
  remainingSeconds: number;
  className?: string;
};

export default function SmsResendCooldownNotice({
  remainingSeconds,
  className = "text-sm text-red-600",
}: Props) {
  if (remainingSeconds <= 0) {
    return null;
  }

  return (
    <p className={className} aria-live="polite">
      {formatSmsResendRateLimitLiveMessage(remainingSeconds)}
    </p>
  );
}
