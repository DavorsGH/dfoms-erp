"use client";

import { useEffect } from "react";
import ClientCacheSessionGuard from "@/components/client-cache-session-guard";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  }, []);

  return <ClientCacheSessionGuard />;
}
