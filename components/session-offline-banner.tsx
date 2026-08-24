"use client";

import { useEffect, useRef } from "react";
import OfflineBanner from "@/components/offline-banner";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { createClient } from "@/utils/supabase/client";

/**
 * Shows whenever the browser is offline inside an authenticated shell.
 * On reconnect, refreshes Auth (getUser) in the background.
 * Write-queue drain is handled by WriteQueueProvider.
 */
export default function SessionOfflineBanner() {
  const isOnline = useOnlineStatus();
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }

    if (!wasOfflineRef.current) {
      return;
    }

    wasOfflineRef.current = false;
    const supabase = createClient();
    void supabase.auth.getUser().catch(() => {
      // Non-fatal — session cookies remain; next navigation may re-verify.
    });
  }, [isOnline]);

  return (
    <OfflineBanner
      show={!isOnline}
      message="You're offline. Your session is still active — Attendance and Expenses can be queued for sync; other writes need a connection."
    />
  );
}
