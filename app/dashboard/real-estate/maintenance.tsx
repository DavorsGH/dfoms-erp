"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  MAINTENANCE_STATUS_OPTIONS,
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceReportedBy,
  formatMaintenanceStatus,
  type ActiveLeaseOption,
  type MaintenanceListRow,
  type MaintenanceStatus,
} from "./maintenance-utils";
import MaintenanceBeforeAfterGallery from "./maintenance-before-after-gallery";

type MaintenanceProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: MaintenanceListRow[];
  activeLeases: ActiveLeaseOption[];
  landlordsError: string | null;
  maintenanceError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const emptyForm = {
  lease_id: "",
  description: "",
  cost_ghs: "",
};

export default function Maintenance({
  landlords,
  selectedLandlordId,
  initialRows,
  activeLeases,
  landlordsError,
  maintenanceError,
}: MaintenanceProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? maintenanceError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(
    null,
  );
  const [editStatus, setEditStatus] = useState<MaintenanceStatus>("submitted");
  const [editCost, setEditCost] = useState("");
  const [completionPhotoFiles, setCompletionPhotoFiles] = useState<File[]>([]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (!expandedRequestId) {
      return;
    }
    const current = initialRows.find(
      (row) => row.requestId === expandedRequestId,
    );
    if (!current) {
      setExpandedRequestId(null);
      return;
    }
    setEditStatus(current.status);
    setEditCost(current.costGhs != null ? String(current.costGhs) : "");
  }, [initialRows, expandedRequestId]);

  useEffect(() => {
    setError(landlordsError ?? maintenanceError);
  }, [landlordsError, maintenanceError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  const filteredRows = useMemo(() => {
    if (!statusFilter) {
      return rows;
    }
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  const expandedRow = rows.find((row) => row.requestId === expandedRequestId);

  function handleLandlordChange(tenantId: string) {
    setShowForm(false);
    setForm(emptyForm);
    setPhotoFiles([]);
    setExpandedRequestId(null);
    setSuccess(null);
    if (!tenantId) {
      router.push("/dashboard/real-estate/maintenance");
      return;
    }
    router.push(
      `/dashboard/real-estate/maintenance?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function openDetail(row: MaintenanceListRow) {
    setError(null);
    setSuccess(null);
    setExpandedRequestId(row.requestId);
    setEditStatus(row.status);
    setEditCost(row.costGhs != null ? String(row.costGhs) : "");
    setCompletionPhotoFiles([]);
  }

  async function uploadSubmissionPhotos(requestId: string, files: File[]) {
    if (!selectedLandlordId || files.length === 0) {
      return { ok: true as const };
    }

    for (const file of files) {
      const formData = new FormData();
      formData.set("tenant_id", selectedLandlordId);
      formData.set("request_id", requestId);
      formData.set("file", file);

      const response = await fetch("/api/admin/maintenance/upload-photo", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        return {
          ok: false as const,
          error: payload?.error ?? "Unable to upload photo.",
        };
      }
    }

    return { ok: true as const };
  }

  async function uploadCompletionPhotos(requestId: string, files: File[]) {
    if (!selectedLandlordId || files.length === 0) {
      return { ok: true as const };
    }

    for (const file of files) {
      const formData = new FormData();
      formData.set("tenant_id", selectedLandlordId);
      formData.set("request_id", requestId);
      formData.set("file", file);

      const response = await fetch(
        "/api/admin/maintenance/upload-completion-photo",
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        return {
          ok: false as const,
          error: payload?.error ?? "Unable to upload completion photo.",
        };
      }
    }

    return { ok: true as const };
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/maintenance/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        lease_id: form.lease_id,
        description: form.description,
        cost_ghs: form.cost_ghs.trim() === "" ? null : form.cost_ghs,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      request_id?: string;
    } | null;

    if (!response.ok || !payload?.request_id) {
      setError(payload?.error ?? "Unable to create maintenance request.");
      setLoading(false);
      return;
    }

    if (photoFiles.length > 0) {
      const uploadResult = await uploadSubmissionPhotos(payload.request_id, photoFiles);
      if (!uploadResult.ok) {
        setError(
          `Request created, but photo upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setShowForm(false);
        setForm(emptyForm);
        setPhotoFiles([]);
        router.refresh();
        return;
      }
    }

    setShowForm(false);
    setForm(emptyForm);
    setPhotoFiles([]);
    setLoading(false);
    setSuccess("Maintenance request created.");
    router.refresh();
  }

  async function handleUpdateStatus(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !expandedRequestId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const body: Record<string, unknown> = {
      tenant_id: selectedLandlordId,
      request_id: expandedRequestId,
      status: editStatus,
    };

    if (expandedRow?.landlordApprovalStatus === "pending") {
      body.cost_ghs = editCost.trim() === "" ? null : editCost;
    }

    const response = await fetch("/api/admin/maintenance/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update request.");
      setLoading(false);
      return;
    }

    if (editStatus === "completed" && completionPhotoFiles.length > 0) {
      const uploadResult = await uploadCompletionPhotos(
        expandedRequestId,
        completionPhotoFiles,
      );
      if (!uploadResult.ok) {
        setError(
          `Status updated, but completion photo upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setCompletionPhotoFiles([]);
        router.refresh();
        return;
      }
      setCompletionPhotoFiles([]);
    }

    setLoading(false);
    setSuccess("Maintenance request updated.");
    router.refresh();
  }

  async function handleLandlordDecision(decision: "approve" | "reject") {
    if (!selectedLandlordId || !expandedRequestId || !expandedRow) {
      return;
    }

    const selfFix = expandedRow.tenantSelfFix;
    const confirmMessage =
      decision === "approve"
        ? selfFix
          ? "Approve this tenant self-fix cost? The amount will be credited against their next rent (no escrow deduction)."
          : "Approve this cost on behalf of the landlord? This will deduct the amount from their escrow balance."
        : "Reject this maintenance request? No financial change will be made.";

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/maintenance/landlord-decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        request_id: expandedRequestId,
        decision,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          `Unable to ${decision === "approve" ? "approve" : "reject"} request.`,
      );
      setLoading(false);
      return;
    }

    setLoading(false);
    setSuccess(
      decision === "approve"
        ? "Landlord approved. Escrow deducted."
        : "Landlord rejected. No financial change.",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="maintenance-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="maintenance-landlord-picker"
          className={inputClassName}
          value={selectedLandlordId ?? ""}
          onChange={(event) => handleLandlordChange(event.target.value)}
        >
          <option value="">Select a Davors-managed landlord…</option>
          {landlords.map((landlord) => (
            <option key={landlord.tenantId} value={landlord.tenantId}>
              {landlord.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {!selectedLandlordId ? (
        <p className="text-sm text-slate-600">
          Select a Davors-managed landlord to view and create maintenance
          requests.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0f2744]">
                {selectedLandlord?.name ?? "Landlord"}
              </h2>
              <p className="text-sm text-slate-600">
                Maintenance requests for this landlord&apos;s tenants.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="maintenance-status-filter"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Filter by status
                </label>
                <select
                  id="maintenance-status-filter"
                  className={inputClassName}
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value="">All statuses</option>
                  {MAINTENANCE_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={loading || activeLeases.length === 0}
                onClick={() => {
                  setShowForm((current) => !current);
                  setForm(emptyForm);
                  setPhotoFiles([]);
                  setError(null);
                  setSuccess(null);
                }}
              >
                {showForm ? "Cancel" : "Add Request"}
              </button>
            </div>
          </div>

          {activeLeases.length === 0 ? (
            <p className="text-sm text-slate-600">
              This landlord has no active leases. Create a lease before adding
              maintenance requests.
            </p>
          ) : null}

          {showForm ? (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h3 className="text-base font-semibold text-[#0f2744]">
                Add Maintenance Request
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="maintenance-lease"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Lease
                  </label>
                  <select
                    id="maintenance-lease"
                    required
                    className={inputClassName}
                    value={form.lease_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        lease_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select an active lease…</option>
                    {activeLeases.map((lease) => (
                      <option key={lease.leaseId} value={lease.leaseId}>
                        {lease.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="maintenance-description"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Description
                  </label>
                  <textarea
                    id="maintenance-description"
                    required
                    rows={3}
                    className={textareaClassName}
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor="maintenance-cost"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Cost (GHS, optional)
                  </label>
                  <input
                    id="maintenance-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    className={inputClassName}
                    value={form.cost_ghs}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        cost_ghs: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    Photos (optional)
                  </p>
                  <ImageFileUploadButton
                    inputId="maintenance-photos"
                    files={photoFiles}
                    onChange={setPhotoFiles}
                    multiple
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Reported by staff. Status starts as Submitted; landlord approval
                starts as Pending.
              </p>
              <button
                type="submit"
                className={primaryButtonClassName}
                disabled={loading}
              >
                {loading ? "Saving…" : "Create request"}
              </button>
            </form>
          ) : null}

          <FilteredListCount
            filteredCount={filteredRows.length}
            totalCount={rows.length}
            itemSingular="request"
            hasActiveFilters={Boolean(statusFilter)}
          />

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Tenant</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Source</th>
                  <th className={scrollableTableWrapThClassName}>Description</th>
                  <th className={scrollableTableThClassName}>Cost</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>
                    Landlord Approval
                  </th>
                  <th className={scrollableTableThClassName}>Date Reported</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No maintenance requests for this landlord
                      {statusFilter ? " with the selected status" : ""}.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr
                      key={row.requestId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {row.lesseeName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitLabel}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatMaintenanceReportedBy(row.reportedBy)}
                        {row.tenantSelfFix ? " · Self-fix" : ""}
                      </td>
                      <td className={`${scrollableTableWrapTdClassName} text-sm text-slate-700`}>
                        {row.description}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {row.tenantSelfFix && row.proposedCostGhs != null
                          ? formatMaintenanceMoney(row.proposedCostGhs)
                          : formatMaintenanceMoney(row.costGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatMaintenanceStatus(row.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatMaintenanceLandlordApproval(
                          row.landlordApprovalStatus,
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatMaintenanceDate(row.dateReported)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={() =>
                            expandedRequestId === row.requestId
                              ? setExpandedRequestId(null)
                              : openDetail(row)
                          }
                        >
                          {expandedRequestId === row.requestId
                            ? "Close"
                            : "Open"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {expandedRow ? (
            <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="text-base font-semibold text-[#0f2744]">
                  Request detail
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {expandedRow.lesseeName} · {expandedRow.unitLabel} · Source:{" "}
                  {formatMaintenanceReportedBy(expandedRow.reportedBy)}
                  {expandedRow.tenantSelfFix ? " (self-fix)" : ""}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                  {expandedRow.description}
                </p>
              </div>

              <form onSubmit={handleUpdateStatus} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label
                      htmlFor="maintenance-edit-status"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Work status
                    </label>
                    <select
                      id="maintenance-edit-status"
                      className={inputClassName}
                      value={editStatus}
                      onChange={(event) =>
                        setEditStatus(event.target.value as MaintenanceStatus)
                      }
                    >
                      {MAINTENANCE_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {expandedRow.landlordApprovalStatus === "pending" ? (
                    <div>
                      <label
                        htmlFor="maintenance-edit-cost"
                        className="mb-1 block text-sm font-medium text-slate-700"
                      >
                        Cost (GHS)
                      </label>
                      <input
                        id="maintenance-edit-cost"
                        type="number"
                        min="0"
                        step="0.01"
                        className={inputClassName}
                        value={editCost}
                        onChange={(event) => setEditCost(event.target.value)}
                        placeholder="Set before landlord approval"
                      />
                    </div>
                  ) : (
                    <div>
                      <p className="mb-1 text-sm font-medium text-slate-700">
                        Cost (GHS)
                      </p>
                      <p className="text-sm text-slate-900">
                        {formatMaintenanceMoney(expandedRow.costGhs)}
                      </p>
                    </div>
                  )}
                  <div>
                    <MaintenanceBeforeAfterGallery
                      submissionPhotoUrls={expandedRow.photoUrls}
                      completionPhotoUrls={expandedRow.completionPhotoUrls}
                      tenantId={expandedRow.tenantId}
                    />
                  </div>
                  {editStatus === "completed" ||
                  expandedRow.status === "completed" ? (
                    <div>
                      <p className="mb-1 text-sm font-medium text-slate-700">
                        Add after photos (completed work)
                      </p>
                      <ImageFileUploadButton
                        inputId="maintenance-completion-photos"
                        files={completionPhotoFiles}
                        onChange={setCompletionPhotoFiles}
                        multiple
                      />
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  className={primaryButtonClassName}
                  disabled={loading}
                >
                  {loading ? "Saving…" : "Save status / cost / photos"}
                </button>
              </form>

              {expandedRow.landlordApprovalStatus === "pending" &&
              (expandedRow.tenantSelfFix
                ? expandedRow.proposedCostGhs != null
                : expandedRow.costGhs != null) ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="mb-3 text-sm text-amber-950">
                    {expandedRow.tenantSelfFix ? (
                      <>
                        Tenant self-fix pending for{" "}
                        {formatMaintenanceMoney(expandedRow.proposedCostGhs)}.
                        Approving credits this amount against the tenant&apos;s
                        next rent period (no escrow deduction).
                      </>
                    ) : (
                      <>
                        Landlord approval is pending for{" "}
                        {formatMaintenanceMoney(expandedRow.costGhs)}. Approving
                        deducts this amount from escrow. Rejecting has no
                        financial effect.
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={primaryButtonClassName}
                      disabled={loading}
                      onClick={() => handleLandlordDecision("approve")}
                    >
                      {expandedRow.tenantSelfFix
                        ? "Approve (credit next rent)"
                        : "Approve (deduct from escrow)"}
                    </button>
                    <button
                      type="button"
                      className={dangerButtonClassName}
                      disabled={loading}
                      onClick={() => handleLandlordDecision("reject")}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Landlord approval
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatMaintenanceLandlordApproval(
                      expandedRow.landlordApprovalStatus,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Reported by
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatMaintenanceReportedBy(expandedRow.reportedBy)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Date reported
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatMaintenanceDate(expandedRow.dateReported)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Date resolved
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatMaintenanceDate(expandedRow.dateResolved)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
