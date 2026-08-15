"use client";

import { useEffect, useState } from "react";
import type { PushPersona } from "@/utils/push-notification-types";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import {
  getNotificationPermission,
  isPushSupportedInBrowser,
  needsIosInstallForPush,
} from "@/utils/push-client";

function bellPromptStorageKey(persona: PushPersona): string {
  return `dfoms-bell-push-prompt-seen:${persona}`;
}

type NotificationBellPushPromptProps = {
  persona: PushPersona;
  open: boolean;
};

function IosInstallBanner() {
  return (
    <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      <p className="font-medium">Install to Home Screen to get alerts</p>
      <p className="mt-1 text-xs leading-relaxed">
        On iPhone and iPad, device notifications work only after adding this app
        to your Home Screen, then enabling push in Account settings.
      </p>
    </div>
  );
}

function DefaultPermissionEnablePrompt({ persona }: { persona: PushPersona }) {
  const push = usePushNotifications(persona, { skipInitialRefresh: true });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storageKey = bellPromptStorageKey(persona);
    if (window.localStorage.getItem(storageKey)) {
      return;
    }

    window.localStorage.setItem(storageKey, "1");
    setVisible(true);
  }, [persona]);

  if (!visible) {
    return null;
  }

  return (
    <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
      <p className="text-sm font-medium text-[#0f2744]">Get alerts on this device</p>
      <p className="mt-1 text-xs text-slate-600">
        Enable push notifications to hear alerts when new items arrive in your inbox.
      </p>
      {push.error ? (
        <p className="mt-2 text-xs text-red-600">{push.error}</p>
      ) : null}
      <button
        type="button"
        disabled={push.busy}
        onClick={() => {
          void push.enable();
        }}
        className="mt-3 inline-flex rounded-md bg-[#0f2744] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {push.busy ? "Enabling…" : "Enable"}
      </button>
    </div>
  );
}

/**
 * Soft opt-in shown once on the first bell open when browser permission is still default.
 * Avoids mounting push subscription hooks when permission is already decided.
 */
export default function NotificationBellPushPrompt({
  persona,
  open,
}: NotificationBellPushPromptProps) {
  if (!open) {
    return null;
  }

  if (typeof window === "undefined") {
    return null;
  }

  if (window.localStorage.getItem(bellPromptStorageKey(persona))) {
    return null;
  }

  if (!isPushSupportedInBrowser()) {
    return null;
  }

  if (needsIosInstallForPush()) {
    return <IosInstallBanner />;
  }

  if (getNotificationPermission() !== "default") {
    return null;
  }

  return <DefaultPermissionEnablePrompt persona={persona} />;
}
