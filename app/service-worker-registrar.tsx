"use client";

import { useEffect } from "react";
import ClientCacheSessionGuard from "@/components/client-cache-session-guard";
import { requestOfflineNavWarm } from "@/lib/offline-nav-warm";

export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // next dev serves Turbopack/HMR chunks that cannot be reliably precached.
    // An active SW on localhost intercepts those requests; offline reload then
    // leaves chunks "pending" forever and React never hydrates (POS Add to Cart
    // appears dead). Production/staging builds use stable /_next/static assets.
    if (process.env.NODE_ENV === "development") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          void registration.unregister();
        }
      });
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
