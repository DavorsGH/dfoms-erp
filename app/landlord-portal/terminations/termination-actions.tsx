"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  portalDangerButtonClassName,
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../portal-ui";

type TerminationActionsProps = {
  leaseId: string;
};

export default function LandlordPortalTerminationActions({
  leaseId,
}: TerminationActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(action: "approve" | "reject") {
    const confirmMessage =
      action === "approve"
        ? "Approve early termination? The lease will be terminated immediately."
        : "Reject this termination request? The lease will continue.";
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/terminations/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lease_id: leaseId, action }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          `Unable to ${action === "approve" ? "approve" : "reject"} request.`,
      );
      setLoading(false);
      return;
    }

    setSuccess(
      action === "approve"
        ? "Termination approved. Lease ended early; tenant notified."
        : "Termination rejected. Lease continues; tenant notified.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
      <p className="text-sm text-amber-950">
        Pending your decision. Approving ends the lease early (same as staff
        terminate early).
      </p>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={portalPrimaryButtonClassName}
          disabled={loading}
          onClick={() => void submit("approve")}
        >
          {loading ? "Working…" : "Approve termination"}
        </button>
        <button
          type="button"
          className={portalDangerButtonClassName}
          disabled={loading}
          onClick={() => void submit("reject")}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
