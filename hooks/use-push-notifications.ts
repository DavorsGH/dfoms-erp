"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PushPersona } from "@/utils/push-notification-types";
import {
  getNotificationPermission,
  isPushSupportedInBrowser,
  isStandalonePwa,
  needsIosInstallForPush,
  PUSH_BLOCKED_MESSAGE,
  PUSH_IOS_MESSAGE,
  PUSH_UNAVAILABLE_MESSAGE,
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
  /** Resolves to a message when push could not be enabled. */
  enable: () => Promise<string | null>;
  disable: () => Promise<string | null>;
};

const PUSH_READY_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), PUSH_READY_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(message));
      },
    );
  });
}

async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    throw new Error(PUSH_UNAVAILABLE_MESSAGE);
  }
  return withTimeout(navigator.serviceWorker.ready, PUSH_UNAVAILABLE_MESSAGE);
}

async function fetchVapidPublicKey(): Promise<string | null> {
  const response = await fetch("/api/push/vapid-public-key");
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json()) as { publicKey?: string };
  return payload.publicKey?.trim() || null;
}

async function fetchSubscriptionStatus(persona: PushPersona): Promise<boolean> {
  const cached = subscriptionStatusCache.get(persona);
  if (cached) {
    return cached.subscribed;
  }

  const response = await fetch(
    `/api/push/subscribe?persona=${encodeURIComponent(persona)}`,
  );
  if (!response.ok) {
    return false;
  }
  const payload = (await response.json()) as { subscribed?: boolean };
  const subscribed = payload.subscribed === true;
  subscriptionStatusCache.set(persona, { subscribed });
  return subscribed;
}

const subscriptionStatusCache = new Map<
  PushPersona,
  { subscribed: boolean }
>();

export function invalidatePushSubscriptionCache(persona?: PushPersona): void {
  if (persona) {
    subscriptionStatusCache.delete(persona);
    return;
  }
  subscriptionStatusCache.clear();
}

type UsePushNotificationsOptions = {
  /** Skip server subscription lookup on mount (bell soft-prompt). */
  skipInitialRefresh?: boolean;
};

export function usePushNotifications(
  persona: PushPersona,
  options: UsePushNotificationsOptions = {},
): UsePushNotificationsResult {
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
    if (options.skipInitialRefresh) {
      if (!isPushSupportedInBrowser()) {
        setStatus("unsupported");
      } else if (isIosInstallRequired) {
        setStatus("ios_install_required");
      } else {
        const permission = getNotificationPermission();
        if (permission === "denied") {
          setStatus("denied");
        } else if (permission === "default") {
          setStatus("default");
        } else {
          setStatus("unsubscribed");
        }
      }
      return;
    }

    void refresh();
  }, [isIosInstallRequired, options.skipInitialRefresh, refresh]);

  const enable = useCallback(async () => {
    if (busy) {
      return null;
    }

    const fail = (nextStatus: PushStatus, message: string) => {
      setStatus(nextStatus);
      setError(message);
      return message;
    };

    setBusy(true);
    setError(null);

    try {
      if (!isPushSupportedInBrowser()) {
        return fail("unsupported", PUSH_UNAVAILABLE_MESSAGE);
      }

      if (needsIosInstallForPush()) {
        return fail("ios_install_required", PUSH_IOS_MESSAGE);
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        return fail(
          permission === "denied" ? "denied" : "default",
          permission === "denied"
            ? PUSH_BLOCKED_MESSAGE
            : "Allow notifications for this site, then try again.",
        );
      }

      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) {
        return fail("error", PUSH_UNAVAILABLE_MESSAGE);
      }

      const registration = await readyServiceWorker();
      let subscription = await withTimeout(
        registration.pushManager.getSubscription(),
        PUSH_UNAVAILABLE_MESSAGE,
      );
      if (!subscription) {
        subscription = await withTimeout(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
          }),
          PUSH_UNAVAILABLE_MESSAGE,
        );
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
        return fail("error", payload.error ?? "Failed to enable push notifications.");
      }

      setStatus("subscribed");
      invalidatePushSubscriptionCache(persona);
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : PUSH_UNAVAILABLE_MESSAGE;
      return fail("error", message);
    } finally {
      setBusy(false);
    }
  }, [busy, persona]);

  const disable = useCallback(async () => {
    if (busy) {
      return null;
    }

    setBusy(true);
    setError(null);

    try {
      const registration = await readyServiceWorker();
      const subscription = await withTimeout(
        registration.pushManager.getSubscription(),
        PUSH_UNAVAILABLE_MESSAGE,
      );

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
      invalidatePushSubscriptionCache(persona);
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "Failed to disable push notifications.";
      setStatus("error");
      setError(message);
      return message;
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
