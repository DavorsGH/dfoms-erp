"use client";

import type { PushPersona } from "@/utils/push-notification-types";
import { usePushNotifications } from "@/hooks/use-push-notifications";

type PushNotificationsSettingsProps = {
  persona: PushPersona;
  className?: string;
  titleClassName?: string;
  bodyClassName?: string;
};

function IosInstallInstructions() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-medium">Install to Home Screen to enable notifications</p>
      <p className="mt-2">
        On iPhone and iPad, Web Push works only after you install this app to your
        Home Screen (iOS 16.4 or later). Open Safari&apos;s Share menu, then tap{" "}
        <span className="font-medium">Add to Home Screen</span>, open the installed
        app, and return here to enable push notifications.
      </p>
    </div>
  );
}

export default function PushNotificationsSettings({
  persona,
  className = "rounded-lg border border-slate-200 bg-white p-6 shadow-sm",
  titleClassName = "text-lg font-semibold text-[#0f2744]",
  bodyClassName = "text-sm text-slate-600",
}: PushNotificationsSettingsProps) {
  const push = usePushNotifications(persona);

  return (
    <section className={className}>
      <h2 className={titleClassName}>Push notifications</h2>
      <p className={`mt-2 ${bodyClassName}`}>
        Receive device alerts with sound when a new in-app notification arrives on
        this device.
      </p>

      {push.status === "unsupported" ? (
        <p className="mt-4 text-sm text-slate-500">
          Push notifications are not supported in this browser.
        </p>
      ) : push.isIosInstallRequired ? (
        <div className="mt-4">
          <IosInstallInstructions />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900">
              {push.enabled ? "Enabled on this device" : "Disabled on this device"}
            </p>
            {push.status === "denied" ? (
              <p className="mt-1 text-sm text-slate-500">
                Notifications are blocked in your browser settings. Allow notifications
                for this site, then try again.
              </p>
            ) : null}
            {push.error ? (
              <p className="mt-1 text-sm text-red-600">{push.error}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              if (push.enabled) {
                void push.disable();
              } else {
                void push.enable();
              }
            }}
            disabled={push.busy || push.status === "denied"}
            className="inline-flex rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {push.busy
              ? "Saving…"
              : push.enabled
                ? "Disable push notifications"
                : "Enable push notifications"}
          </button>
        </div>
      )}
    </section>
  );
}
