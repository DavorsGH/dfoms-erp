"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PushPersona } from "@/utils/push-notification-types";
import {
  getNotificationPermission,
  isPushSupportedInBrowser,
  isStandalonePwa,
  needsIosInstallForPush,
  urlBase64ToUint8Array,
} from "@/utils/push-client";

type PushStatus =
  | "unsupported"
  | "ios_install_required"
  | "denied"
  | "default"
  | "checking"
  | "subscribed"
  | "unsubscribed"
  | "error";

type UsePushNotificationsResult = {
  status: PushStatus;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  isIosInstallRequired: boolean;
  isStandalone: boolean;
  refresh: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};

async function fetchVapidPublicKey(): Promise<string | null> {
  const response = await fetch("/api/push/vapid-public-key");
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { publicKey?: string };
  return payload.publicKey?.trim() || null;
}

async function fetchSubscriptionStatus(persona: PushPersona): Promise<boolean> {
  const response = await fetch(
    `/api/push/subscribe?persona=${encodeURIComponent(persona)}`,
  );
  if (!response.ok) {
    return false;
  }
  const payload = (await response.json()) as { subscribed?: boolean };
  return payload.subscribed === true;
}

export function usePushNotifications(persona: PushPersona): UsePushNotificationsResult {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStandalone = isStandalonePwa();
  const isIosInstallRequired = needsIosInstallForPush();

  const refresh = useCallback(async () => {
    setError(null);

    if (!isPushSupportedInBrowser()) {
      setStatus("unsupported");
      return;
    }

    if (isIosInstallRequired) {
      setStatus("ios_install_required");
      return;
    }

    const permission = getNotificationPermission();
    if (permission === "denied") {
      setStatus("denied");
      return;
    }

    if (permission === "default") {
      setStatus("default");
      return;
    }

    const subscribed = await fetchSubscriptionStatus(persona);
    setStatus(subscribed ? "subscribed" : "unsubscribed");
  }, [isIosInstallRequired, persona]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (!isPushSupportedInBrowser()) {
        setStatus("unsupported");
        return;
      }

      if (needsIosInstallForPush()) {
        setStatus("ios_install_required");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }

      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) {
        setStatus("error");
        setError("Push notifications are not configured on this environment.");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        });
      }

      const json = subscription.toJSON();
      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona,
          subscription: json,
          isStandalonePwa: isStandalonePwa(),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus("error");
        setError(payload.error ?? "Failed to enable push notifications.");
        return;
      }

      setStatus("subscribed");
    } catch (cause) {
      setStatus("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to enable push notifications.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, persona]);

  const disable = useCallback(async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        const endpoint = subscription.endpoint;
        await fetch("/api/push/unsubscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona, endpoint }),
        });
        await subscription.unsubscribe();
      } else {
        await fetch("/api/push/unsubscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona }),
        });
      }

      setStatus(
        getNotificationPermission() === "granted" ? "unsubscribed" : "default",
      );
    } catch (cause) {
      setStatus("error");
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to disable push notifications.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, persona]);

  const enabled = status === "subscribed";

  return useMemo(
    () => ({
      status,
      enabled,
      busy,
      error,
      isIosInstallRequired,
      isStandalone,
      refresh,
      enable,
      disable,
    }),
    [
      busy,
      disable,
      enable,
      enabled,
      error,
      isIosInstallRequired,
      isStandalone,
      refresh,
      status,
    ],
  );
}
