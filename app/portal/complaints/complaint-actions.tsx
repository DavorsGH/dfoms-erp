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

type PortalComplaintActionsProps = {
  complaintId: string;
  initialResponse: string | null;
};

export default function PortalComplaintActions({
  complaintId,
  initialResponse,
}: PortalComplaintActionsProps) {
  const router = useRouter();
  const [responseText, setResponseText] = useState(initialResponse ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleRespond() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/portal/complaints/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        complaint_id: complaintId,
        response: responseText,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to send response.");
      setLoading(false);
      return;
    }

    setSuccess("Response sent. Your landlord has been notified.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div>
        <label
          htmlFor={`tenant-complaint-response-${complaintId}`}
          className={portalLabelClassName}
        >
          Your response
        </label>
        <textarea
          id={`tenant-complaint-response-${complaintId}`}
          className={`${portalInputClassName} min-h-[80px]`}
          value={responseText}
          onChange={(event) => setResponseText(event.target.value)}
          disabled={loading}
          placeholder="Explain your side or how you plan to address this…"
        />
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <button
        type="button"
        className={portalPrimaryButtonClassName}
        disabled={loading || !responseText.trim()}
        onClick={() => void handleRespond()}
      >
        {loading ? "Sending…" : "Send response"}
      </button>
    </div>
  );
}
