"use client";

import { useEffect, useState } from "react";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import type { PushPersona } from "@/utils/push-notification-types";
import { PUSH_UNAVAILABLE_MESSAGE } from "@/utils/push-client";

type PushNotificationsSettingsProps = {
  persona: PushPersona;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
};

export default function PushNotificationsSettings({
  persona,
  className = "rounded-lg border border-slate-200 bg-white p-6 shadow-sm",
  titleClassName = "text-lg font-semibold text-[#0f2744]",
  bodyClassName = "text-sm text-slate-600",
}: PushNotificationsSettingsProps) {
  const push = usePushNotifications(persona);
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [host, setHost] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  async function onToggle() {
    if (push.enabled) {
      const message = await push.disable();
      if (message) {
        await alertError(message);
      } else {
        toast("Push notifications turned off on this device");
      }
      return;
    }

    const message = await push.enable();
    if (message) {
      await alertError(message);
      return;
    }
    toast("Push notifications enabled on this device");
  }

  async function onSendTest() {
    if (testing) {
      return;
    }
    setTesting(true);
    try {
      if (!("serviceWorker" in navigator)) {
        setTesting(false);
        await alertError(PUSH_UNAVAILABLE_MESSAGE);
        return;
      }
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(PUSH_UNAVAILABLE_MESSAGE)), 8000);
        }),
      ]);
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        setTesting(false);
        await alertError("This device is not subscribed.");
        return;
      }

      const response = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona, endpoint: subscription.endpoint }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        setTesting(false);
        await alertError(
          payload?.error ?? "The test notification could not be delivered.",
        );
        return;
      }
      toast("Test notification sent");
    } catch {
      setTesting(false);
      await alertError(
        "Couldn't reach the server. Check your connection and try again.",
      );
      return;
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={className}>
      <h2 className={titleClassName}>Push notifications</h2>
      <p className={`mt-2 ${bodyClassName}`}>
        Receive device alerts with sound when a new in-app notification arrives on
        this device.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {push.enabled ? "Enabled on this device" : "Disabled on this device"}
          </p>
          {push.enabled && host ? (
            <p className="mt-1 text-sm text-slate-600">
              This device is subscribed on {host}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void onToggle();
            }}
            disabled={push.busy || testing}
            className="inline-flex rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {push.busy
              ? "Saving…"
              : push.enabled
                ? "Disable push notifications"
                : "Enable push notifications"}
          </button>
          {push.enabled ? (
            <button
              type="button"
              onClick={() => {
                void onSendTest();
              }}
              disabled={push.busy || testing}
              className="inline-flex rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testing ? "Sending…" : "Send test notification"}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
