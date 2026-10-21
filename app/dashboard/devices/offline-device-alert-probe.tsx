"use client";

import { useEffect } from "react";

const STORAGE_KEY = "dfoms.attendance.offlineCheckAt";
const MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Lazy offline check after paint. Callers mount this only for hub roles.
 * The request itself also refuses other roles, and returns before any
 * notification work when the tenant has no attendance devices.
 */
export default function OfflineDeviceAlertProbe() {
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const last = raw ? Number(raw) : 0;
      if (Number.isFinite(last) && Date.now() - last < MIN_INTERVAL_MS) {
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
    } catch {
      // sessionStorage can throw in private mode; still try this mount.
    }

    void fetch("/api/attendance/offline-check", { method: "POST" }).catch(() => {
      // Alert creation is best-effort; the Devices list still shows Offline.
    });
  }, []);

  return null;
}
