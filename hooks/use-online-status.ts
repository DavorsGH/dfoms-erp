"use client";

import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    function sync() {
      setIsOnline(navigator.onLine);
    }

    function onOnline() {
      queueMicrotask(() => setIsOnline(navigator.onLine));
    }

    function onOffline() {
      queueMicrotask(() => setIsOnline(navigator.onLine));
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", sync);
    // Pick up Playwright/DevTools offline flips that can race hydration.
    sync();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return isOnline;
}

export function useOfflineWriteBlocked(): {
  isOffline: boolean;
  offlineWriteMessage: string;
} {
  const isOffline = !useOnlineStatus();
  return {
    isOffline,
    offlineWriteMessage:
      "You are offline. Cached data is read-only until your connection returns.",
  };
}
