"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LESSEE_COMPLAINT_STATUS_OPTIONS,
  type LesseeComplaintRaisedBy,
  type LesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

type ComplaintActionsProps = {
  complaintId: string;
  raisedBy: LesseeComplaintRaisedBy;
  initialStatus: string;
  initialResponse: string | null;
};

export default function LandlordPortalComplaintActions({
  complaintId,
  raisedBy,
  initialStatus,
  initialResponse,
}: ComplaintActionsProps) {
  const router = useRouter();
  const isTenantRaised = raisedBy === "tenant";
  const [status, setStatus] = useState(initialStatus);
  const [responseText, setResponseText] = useState(
    isTenantRaised ? (initialResponse ?? "") : "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const staffResponse = isTenantRaised
      ? responseText
      : responseText.trim()
        ? initialResponse
          ? `${initialResponse}\n\nClosing note: ${responseText.trim()}`
          : responseText.trim()
        : initialResponse;

    const response = await fetch("/api/landlord-portal/complaints/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        complaint_id: complaintId,
        status,
        staff_response: staffResponse,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update complaint.");
      setLoading(false);
      return;
    }

    setSuccess(
      status === "resolved"
        ? "Complaint marked resolved. Tenant notified."
        : status === "rejected"
          ? "Complaint rejected. Tenant notified."
          : "Complaint updated.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
      <div>
        <label
          htmlFor={`complaint-status-${complaintId}`}
          className={portalLabelClassName}
        >
          Status
        </label>
        <select
          id={`complaint-status-${complaintId}`}
          className={portalInputClassName}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          disabled={loading}
        >
          {LESSEE_COMPLAINT_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {isTenantRaised ? (
        <div>
          <label
            htmlFor={`complaint-response-${complaintId}`}
            className={portalLabelClassName}
          >
            Your response
          </label>
          <textarea
            id={`complaint-response-${complaintId}`}
            className={`${portalInputClassName} min-h-[80px]`}
            value={responseText}
            onChange={(event) => setResponseText(event.target.value)}
            disabled={loading}
            placeholder="Optional note to the tenant…"
          />
        </div>
      ) : (
        <div>
          <label
            htmlFor={`complaint-closing-${complaintId}`}
            className={portalLabelClassName}
          >
            Closing note (optional)
          </label>
          <textarea
            id={`complaint-closing-${complaintId}`}
            className={`${portalInputClassName} min-h-[80px]`}
            value={responseText}
            onChange={(event) => setResponseText(event.target.value)}
            disabled={loading}
            placeholder="Optional note when resolving or rejecting…"
          />
        </div>
      )}

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
        {loading
          ? "Saving…"
          : (status as LesseeComplaintStatus) === "resolved"
            ? "Save & mark resolved"
            : "Save"}
      </button>
    </div>
  );
}
