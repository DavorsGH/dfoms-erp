"use client";

import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
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
