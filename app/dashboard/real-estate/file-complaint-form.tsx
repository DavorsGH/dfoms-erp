"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";

type FileComplaintFormProps = {
  /** Staff admin API vs landlord portal API. */
  mode: "staff" | "landlord";
  tenantId: string;
  leaseId: string;
  leaseActive: boolean;
  /** Portal styling for landlord portal lease detail. */
  variant?: "staff" | "portal";
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const portalPrimaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const portalTextareaClassName =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const portalInputClassName =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const portalLabelClassName = "block text-sm font-medium text-slate-700";

/**
 * File a landlord-raised complaint about the tenant on a lease.
 */
export default function FileComplaintForm({
  mode,
  tenantId,
  leaseId,
  leaseActive,
  variant = "staff",
}: FileComplaintFormProps) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isPortal = variant === "portal";
  const inputClass = isPortal ? portalInputClassName : inputClassName;
  const textareaClass = isPortal ? portalTextareaClassName : textareaClassName;
  const buttonClass = isPortal
    ? portalPrimaryButtonClassName
    : primaryButtonClassName;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!leaseActive) {
      setError("Complaints can only be filed against an active lease.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint =
      mode === "staff"
        ? "/api/admin/complaints/create"
        : "/api/landlord-portal/complaints/create";

    const body =
      mode === "staff"
        ? {
            tenant_id: tenantId,
            lease_id: leaseId,
            subject,
            description,
          }
        : {
            lease_id: leaseId,
            subject,
            description,
          };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
    setSuccess("Complaint filed. The tenant will be notified.");
    setLoading(false);
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3">
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div>
        <label
          className={isPortal ? portalLabelClassName : "mb-1 block text-xs font-medium text-slate-600"}
          htmlFor={`file-complaint-subject-${leaseId}`}
        >
          Subject
        </label>
        <input
          id={`file-complaint-subject-${leaseId}`}
          className={inputClass}
          required
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          disabled={loading || !leaseActive}
        />
      </div>

      <div>
        <label
          className={isPortal ? portalLabelClassName : "mb-1 block text-xs font-medium text-slate-600"}
          htmlFor={`file-complaint-description-${leaseId}`}
        >
          Description
        </label>
        <textarea
          id={`file-complaint-description-${leaseId}`}
          className={textareaClass}
          rows={4}
          required
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={loading || !leaseActive}
        />
      </div>

      <button
        type="submit"
        className={buttonClass}
        disabled={loading || !leaseActive}
      >
        {loading ? "Submitting…" : "File complaint"}
      </button>
    </form>
  );
}
