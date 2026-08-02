"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

type NotificationContactsFormProps = {
  initialPhone: string | null;
  initialEmail: string | null;
};

export default function LandlordPortalNotificationContactsForm({
  initialPhone,
  initialEmail,
}: NotificationContactsFormProps) {
  const router = useRouter();
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      "/api/landlord-portal/notification-contacts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notification_phone: phone,
          notification_email: email,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save notification contacts.");
      setLoading(false);
      return;
    }

    setSuccess("Notification contacts saved.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-slate-600">
        Used for Real Estate ops alerts (SMS + email). Staff can also update
        these on your landlord detail page.
      </p>
      <div>
        <label htmlFor="landlord-notification-phone" className={portalLabelClassName}>
          Notification phone (SMS)
        </label>
        <input
          id="landlord-notification-phone"
          type="tel"
          className={portalInputClassName}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          disabled={loading}
          placeholder="e.g. 024XXXXXXX"
        />
      </div>
      <div>
        <label htmlFor="landlord-notification-email" className={portalLabelClassName}>
          Notification email
        </label>
        <input
          id="landlord-notification-email"
          type="email"
          className={portalInputClassName}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={loading}
          placeholder="you@example.com"
        />
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <button
        type="button"
        className={portalPrimaryButtonClassName}
        disabled={loading}
        onClick={() => void handleSave()}
      >
        {loading ? "Saving…" : "Save contacts"}
      </button>
    </div>
  );
}
