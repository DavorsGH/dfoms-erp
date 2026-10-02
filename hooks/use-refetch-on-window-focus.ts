"use client";

import { useEffect } from "react";

export function useRefetchOnWindowFocus(
  refetch: () => void | Promise<void>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const run = () => {
      void refetch();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        run();
      }
    };

    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, refetch]);
}
