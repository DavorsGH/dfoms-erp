"use client";

import { useEffect, useRef, useState } from "react";

function computeRemainingSeconds(resendAvailableAtMs: number): number {
  return Math.max(0, Math.ceil((resendAvailableAtMs - Date.now()) / 1000));
}

export function useSmsResendCooldown(
  resendAvailableAtMs: number | null,
  onExpired?: () => void,
): { remainingSeconds: number; isActive: boolean } {
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    resendAvailableAtMs != null ? computeRemainingSeconds(resendAvailableAtMs) : 0,
  );

  useEffect(() => {
    if (resendAvailableAtMs == null) {
      setRemainingSeconds(0);
      return;
    }

    let expiredCalled = false;

    function tick() {
      const next = computeRemainingSeconds(resendAvailableAtMs!);
      setRemainingSeconds(next);
      if (next <= 0 && !expiredCalled) {
        expiredCalled = true;
        onExpiredRef.current?.();
      }
    }

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [resendAvailableAtMs]);

  const isActive =
    resendAvailableAtMs != null && remainingSeconds > 0;

  return { remainingSeconds, isActive };
}
