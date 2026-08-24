"use client";

import { useEffect } from "react";
import ClientCacheSessionGuard from "@/components/client-cache-session-guard";
import { requestOfflineNavWarm } from "@/lib/offline-nav-warm";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(() => {
        void requestOfflineNavWarm();
      })
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  }, []);

  return <ClientCacheSessionGuard />;
}
