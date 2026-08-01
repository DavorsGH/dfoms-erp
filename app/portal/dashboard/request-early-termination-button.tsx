"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalTextareaClassName,
} from "../portal-ui";

type RequestEarlyTerminationButtonProps = {
  alreadyPending: boolean;
  pendingReason: string | null;
};

/**
 * Tenant Portal: submit early-termination request (pending staff approval).
 */
export default function RequestEarlyTerminationButton({
  alreadyPending,
  pendingReason,
}: RequestEarlyTerminationButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (alreadyPending) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="font-medium">Early termination request pending</p>
        <p className="mt-1 text-amber-900">
          Staff are reviewing your request. Your lease remains active until
          approved.
        </p>
        {pendingReason ? (
          <p className="mt-1 text-amber-900">Your reason: {pendingReason}</p>
        ) : null}
      </div>
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/portal/lease/termination-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() || null }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to submit termination request.");
      setLoading(false);
      return;
    }

    setLoading(false);
    setOpen(false);
    setSuccess("Request submitted. Staff will review it shortly.");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
            setSuccess(null);
          }}
          className={portalSecondaryButtonClassName}
        >
          Request Early Termination
        </button>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <p className="text-sm font-medium text-[#0f2744]">
            Request early lease termination
          </p>
          <p className="text-xs text-slate-600">
            This does not end your lease immediately. Staff must approve the
            request.
          </p>
          <div>
            <label
              htmlFor="termination-reason"
              className={portalLabelClassName}
            >
              Reason (optional)
            </label>
            <textarea
              id="termination-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={portalTextareaClassName}
              placeholder="Optional note for your property manager"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={loading}
              className={portalPrimaryButtonClassName}
            >
              {loading ? "Submitting…" : "Submit request"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setOpen(false)}
              className={portalSecondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-700" role="status">
          {success}
        </p>
      ) : null}
    </div>
  );
}
