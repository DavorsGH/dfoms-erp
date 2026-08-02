"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type Props = {
  applicationId: string;
  canDecide: boolean;
};

export default function ApplicationActions({
  applicationId,
  canDecide,
}: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!canDecide) {
    return null;
  }

  async function submit(
    decision: "approve" | "reject" | "request_info" | "under_review",
  ) {
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (decision === "approve") {
      if (
        !window.confirm(
          "Approve this application? The unit will be placed on application hold.",
        )
      ) {
        setLoading(false);
        return;
      }
    } else if (decision === "reject") {
      if (!window.confirm("Reject this application?")) {
        setLoading(false);
        return;
      }
    } else if (decision === "request_info") {
      if (!infoMessage.trim()) {
        setError("Enter a message describing what information you need.");
        setLoading(false);
        return;
      }
    }

    const response = await fetch(
      "/api/landlord-portal/applications/decision",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: applicationId,
          decision,
          landlord_notes: notes || null,
          decision_reason: reason || null,
          info_request_message: infoMessage || null,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      status?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update application.");
      setLoading(false);
      return;
    }

    setSuccess(`Application marked ${payload?.status?.replace(/_/g, " ")}.`);
    setLoading(false);
    router.refresh();
  }

  return (
    <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
        Decision
      </h2>
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div>
        <label className={portalLabelClassName}>Landlord notes</label>
        <input
          className={portalInputClassName}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes"
        />
      </div>
      <div>
        <label className={portalLabelClassName}>Reject reason</label>
        <input
          className={portalInputClassName}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div>
        <label className={portalLabelClassName}>Info request message</label>
        <input
          className={portalInputClassName}
          value={infoMessage}
          onChange={(e) => setInfoMessage(e.target.value)}
          placeholder="What else do you need from the applicant?"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() => submit("under_review")}
          className={portalSecondaryButtonClassName}
        >
          Mark under review
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => submit("request_info")}
          className={portalSecondaryButtonClassName}
        >
          Request more info
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => submit("approve")}
          className={portalPrimaryButtonClassName}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => submit("reject")}
          className={portalDangerButtonClassName}
        >
          Reject
        </button>
      </div>
    </section>
  );
}
