"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatLesseeComplaintDate } from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

type PortalComplaintAcknowledgeProps = {
  complaintId: string;
  acknowledgedAt: string | null;
};

export default function PortalComplaintAcknowledge({
  complaintId,
  acknowledgedAt,
}: PortalComplaintAcknowledgeProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(acknowledgedAt);

  if (acknowledged) {
    return (
      <p className="mt-2 text-sm text-emerald-700">
        Acknowledged {formatLesseeComplaintDate(acknowledged)}
      </p>
    );
  }

  async function handleAcknowledge() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/portal/complaints/acknowledge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ complaint_id: complaintId }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      acknowledged_at?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to acknowledge.");
      setLoading(false);
      return;
    }

    setAcknowledged(payload?.acknowledged_at ?? new Date().toISOString());
    setSuccess("Thank you — your acknowledgment has been recorded.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3">
      <p className="text-sm text-emerald-900">
        This complaint was marked resolved. Please confirm you are satisfied
        with the outcome.
      </p>
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}
      <button
        type="button"
        className={portalPrimaryButtonClassName}
        disabled={loading}
        onClick={() => void handleAcknowledge()}
      >
        {loading ? "Saving…" : "Acknowledge resolution"}
      </button>
    </div>
  );
}
