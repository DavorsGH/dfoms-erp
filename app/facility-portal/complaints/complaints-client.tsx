"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LESSEE_COMPLAINT_STATUS_OPTIONS,
} from "@/app/dashboard/real-estate/complaints-utils";
import type { ActiveLeaseOption } from "@/app/dashboard/real-estate/maintenance-utils";
import type { FacilityComplaintListRow } from "@/utils/facility-portal-types";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSuccessBannerClassName,
  portalTabBarClassName,
  portalTabButtonClassName,
} from "../portal-ui";

type FacilityComplaintsClientProps = {
  rows: FacilityComplaintListRow[];
  leases: ActiveLeaseOption[];
};

type TabId = "list" | "file";

function ComplaintRespondPanel({
  row,
}: {
  row: FacilityComplaintListRow;
}) {
  const router = useRouter();
  const isTenantRaised = row.raisedBy === "tenant";
  const [status, setStatus] = useState(row.status);
  const [responseText, setResponseText] = useState(
    isTenantRaised ? (row.staffResponse ?? "") : "",
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
        ? row.staffResponse
          ? `${row.staffResponse}\n\nClosing note: ${responseText.trim()}`
          : responseText.trim()
        : row.staffResponse;

    const response = await fetch("/api/facility-portal/complaints/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        complaint_id: row.complaintId,
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

    setSuccess("Complaint updated.");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div>
        <label
          className={portalLabelClassName}
          htmlFor={`fm-complaint-status-${row.complaintId}`}
        >
          Status
        </label>
        <select
          id={`fm-complaint-status-${row.complaintId}`}
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
      <div>
        <label
          className={portalLabelClassName}
          htmlFor={`fm-complaint-response-${row.complaintId}`}
        >
          {isTenantRaised ? "Your response" : "Closing note (optional)"}
        </label>
        <textarea
          id={`fm-complaint-response-${row.complaintId}`}
          className={`${portalInputClassName} min-h-[80px]`}
          value={responseText}
          onChange={(event) => setResponseText(event.target.value)}
          disabled={loading}
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
        {loading ? "Saving…" : "Save response"}
      </button>
    </div>
  );
}

export default function FacilityComplaintsClient({
  rows,
  leases,
}: FacilityComplaintsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [leaseId, setLeaseId] = useState(leases[0]?.leaseId ?? "");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);

  async function handleFile(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/facility-portal/complaints/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lease_id: leaseId, subject, description }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to file complaint.");
      setLoading(false);
      return;
    }

    setSubject("");
    setDescription("");
    setSuccess("Complaint filed.");
    setTab("list");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className={portalTabBarClassName} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          className={portalTabButtonClassName(tab === "list")}
          onClick={() => setTab("list")}
        >
          Complaints
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "file"}
          className={portalTabButtonClassName(tab === "file")}
          onClick={() => setTab("file")}
        >
          File complaint
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {tab === "file" ? (
        <section className={portalCompactSectionClassName}>
          <form onSubmit={handleFile} className="space-y-3">
            <div>
              <label className={portalLabelClassName} htmlFor="fm-complaint-lease">
                Lease
              </label>
              <select
                id="fm-complaint-lease"
                className={portalInputClassName}
                value={leaseId}
                onChange={(event) => setLeaseId(event.target.value)}
                required
              >
                <option value="" disabled>
                  Select lease
                </option>
                {leases.map((lease) => (
                  <option key={lease.leaseId} value={lease.leaseId}>
                    {lease.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="fm-complaint-subject">
                Subject
              </label>
              <input
                id="fm-complaint-subject"
                className={portalInputClassName}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="fm-complaint-desc">
                Description
              </label>
              <textarea
                id="fm-complaint-desc"
                className={`${portalInputClassName} min-h-[88px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              className={portalPrimaryButtonClassName}
              disabled={loading || leases.length === 0}
            >
              {loading ? "Submitting…" : "File complaint"}
            </button>
          </form>
        </section>
      ) : rows.length === 0 ? (
        <section className={portalCompactSectionClassName}>
          <p className="text-sm text-slate-600">
            No complaints for your assigned properties yet.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const isExpanded = expandedId === row.complaintId;
            const isTenantRaised = row.raisedBy === "tenant";
            return (
              <li key={row.complaintId} className={portalCompactSectionClassName}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[#0f2744]">
                      {row.subject}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.lesseeName} · {row.unitLabel} · {row.raisedByLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.dateLabel} · {row.statusLabel}
                    </p>
                    {!isExpanded && row.description ? (
                      <p className="mt-1 text-sm text-slate-700">{row.description}</p>
                    ) : null}
                    {!isExpanded && row.staffResponse ? (
                      <p className="mt-1 text-sm text-slate-600">
                        {isTenantRaised ? "Response: " : "Tenant response: "}
                        {row.staffResponse}
                      </p>
                    ) : null}
                  </div>
                  {row.isOpen ? (
                    <button
                      type="button"
                      className={portalSecondaryButtonClassName}
                      onClick={() => toggleExpanded(row.complaintId)}
                    >
                      {isExpanded ? "Hide" : "Review & respond"}
                    </button>
                  ) : null}
                </div>
                {isExpanded && row.isOpen ? (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    {row.description ? (
                      <p className="text-sm text-slate-700">{row.description}</p>
                    ) : null}
                    {row.staffResponse ? (
                      <p className="text-sm text-slate-600">
                        {isTenantRaised ? "Response: " : "Tenant response: "}
                        {row.staffResponse}
                      </p>
                    ) : null}
                    <ComplaintRespondPanel row={row} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
