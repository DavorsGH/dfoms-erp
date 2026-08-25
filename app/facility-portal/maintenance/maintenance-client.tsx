"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  MAINTENANCE_STATUS_OPTIONS,
  type ActiveLeaseOption,
  type MaintenanceListRow,
  type MaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import MaintenanceBeforeAfterGallery from "@/app/dashboard/real-estate/maintenance-before-after-gallery";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceReportedBy,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
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

type FacilityMaintenanceClientProps = {
  leases: ActiveLeaseOption[];
  rows: MaintenanceListRow[];
  tenantId: string;
};

type TabId = "list" | "create";

export default function FacilityMaintenanceClient({
  leases,
  rows,
  tenantId,
}: FacilityMaintenanceClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("list");
  const [leaseId, setLeaseId] = useState(leases[0]?.leaseId ?? "");
  const [description, setDescription] = useState("");
  const [costGhs, setCostGhs] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const sortedRows = useMemo(() => rows, [rows]);

  async function uploadPhotos(requestId: string, files: File[]) {
    for (const file of files) {
      const formData = new FormData();
      formData.set("request_id", requestId);
      formData.set("file", file);
      const response = await fetch(
        "/api/facility-portal/maintenance/upload-photo",
        { method: "POST", body: formData },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Photo upload failed.");
      }
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/facility-portal/maintenance/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lease_id: leaseId,
          description,
          cost_ghs: costGhs.trim() === "" ? null : costGhs,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        request_id?: string;
      } | null;

      if (!response.ok || !payload?.request_id) {
        throw new Error(payload?.error ?? "Unable to create request.");
      }

      if (photoFiles.length > 0) {
        await uploadPhotos(payload.request_id, photoFiles);
      }

      setDescription("");
      setCostGhs("");
      setPhotoFiles([]);
      setSuccess("Maintenance request submitted.");
      setTab("list");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create request.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusUpdate(
    requestId: string,
    currentStatus: MaintenanceStatus,
  ) {
    const nextStatus = statusDrafts[requestId] ?? currentStatus;
    setUpdatingId(requestId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        "/api/facility-portal/maintenance/update-status",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            request_id: requestId,
            status: nextStatus,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to update status.");
      }
      setSuccess("Status updated.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update status.");
    } finally {
      setUpdatingId(null);
    }
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
          Requests
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "create"}
          className={portalTabButtonClassName(tab === "create")}
          onClick={() => setTab("create")}
        >
          New request
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {tab === "create" ? (
        <section className={portalCompactSectionClassName}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className={portalLabelClassName} htmlFor="fm-lease">
                Lease
              </label>
              <select
                id="fm-lease"
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
              <label className={portalLabelClassName} htmlFor="fm-desc">
                Description
              </label>
              <textarea
                id="fm-desc"
                className={`${portalInputClassName} min-h-[88px]`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="fm-cost">
                Estimated cost (GHS, optional)
              </label>
              <input
                id="fm-cost"
                type="number"
                min="0"
                step="0.01"
                className={portalInputClassName}
                value={costGhs}
                onChange={(event) => setCostGhs(event.target.value)}
              />
            </div>
            <div>
              <p className={portalLabelClassName}>Photos (optional)</p>
              <ImageFileUploadButton
                files={photoFiles}
                onChange={setPhotoFiles}
                multiple
              />
            </div>
            <button
              type="submit"
              className={portalPrimaryButtonClassName}
              disabled={loading || leases.length === 0}
            >
              {loading ? "Submitting…" : "Submit request"}
            </button>
            {leases.length === 0 ? (
              <p className="text-sm text-amber-700">
                No active leases on your assigned properties.
              </p>
            ) : null}
          </form>
        </section>
      ) : sortedRows.length === 0 ? (
        <section className={portalCompactSectionClassName}>
          <p className="text-sm text-slate-600">
            No maintenance requests for your assigned properties yet.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {sortedRows.map((row) => {
            const draft = statusDrafts[row.requestId] ?? row.status;
            return (
              <li
                key={row.requestId}
                className={portalCompactSectionClassName}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[#0f2744]">
                      {row.description}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.lesseeName} · {row.unitLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatMaintenanceDate(row.dateReported)} · Cost{" "}
                      {formatMaintenanceMoney(row.costGhs)} · Reported by{" "}
                      {formatMaintenanceReportedBy(row.reportedBy)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <p>{formatMaintenanceStatus(row.status)}</p>
                    <p>
                      Landlord:{" "}
                      {formatMaintenanceLandlordApproval(
                        row.landlordApprovalStatus,
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      className={portalLabelClassName}
                      htmlFor={`status-${row.requestId}`}
                    >
                      Update status
                    </label>
                    <select
                      id={`status-${row.requestId}`}
                      className={portalInputClassName}
                      value={draft}
                      onChange={(event) =>
                        setStatusDrafts((current) => ({
                          ...current,
                          [row.requestId]: event.target.value,
                        }))
                      }
                    >
                      {MAINTENANCE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className={portalSecondaryButtonClassName}
                    disabled={updatingId === row.requestId || draft === row.status}
                    onClick={() =>
                      handleStatusUpdate(
                        row.requestId,
                        row.status,
                      )
                    }
                  >
                    {updatingId === row.requestId ? "Saving…" : "Save status"}
                  </button>
                </div>

                {row.photoUrls.length > 0 ||
                row.completionPhotoUrls.length > 0 ? (
                  <MaintenanceBeforeAfterGallery
                    submissionPhotoUrls={row.photoUrls}
                    completionPhotoUrls={row.completionPhotoUrls}
                    tenantId={tenantId}
                    compact
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
