"use client";

import { useEffect, useState } from "react";

/**
 * Browser online/offline status for UI.
 *
 * SSR-safe: always returns `true` on the server and on the client's first paint.
 * Real `navigator.onLine` is applied only after mount (useEffect), so server HTML
 * and the hydration pass stay identical — same pattern as EmployeePhotoAvatar /
 * WorkspaceLogo offline asset switching.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

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
    // Apply real status after mount (never during the hydration render).
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
