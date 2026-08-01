"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  LESSEE_COMPLAINT_STATUS_OPTIONS,
  formatLesseeComplaintDate,
  formatLesseeComplaintStatus,
  type LesseeComplaintListRow,
  type LesseeComplaintStatus,
} from "./complaints-utils";

type ComplaintsViewProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: LesseeComplaintListRow[];
  landlordsError: string | null;
  complaintsError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ComplaintsView({
  landlords,
  selectedLandlordId,
  initialRows,
  landlordsError,
  complaintsError,
}: ComplaintsViewProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? complaintsError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] =
    useState<LesseeComplaintStatus>("submitted");
  const [editResponse, setEditResponse] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? complaintsError);
  }, [landlordsError, complaintsError]);

  useEffect(() => {
    if (!expandedId) {
      return;
    }
    const current = initialRows.find((row) => row.complaintId === expandedId);
    if (!current) {
      setExpandedId(null);
      return;
    }
    setEditStatus(current.status);
    setEditResponse(current.staffResponse ?? "");
  }, [initialRows, expandedId]);

  const filteredRows = useMemo(() => {
    if (!statusFilter) {
      return rows;
    }
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  const expandedRow = rows.find((row) => row.complaintId === expandedId);

  function handleLandlordChange(tenantId: string) {
    setExpandedId(null);
    setSuccess(null);
    if (!tenantId) {
      router.push("/dashboard/real-estate/complaints");
      return;
    }
    router.push(
      `/dashboard/real-estate/complaints?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function openDetail(row: LesseeComplaintListRow) {
    setExpandedId(row.complaintId);
    setEditStatus(row.status);
    setEditResponse(row.staffResponse ?? "");
    setSuccess(null);
    setError(null);
  }

  async function handleSave() {
    if (!selectedLandlordId || !expandedRow) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/complaints/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: selectedLandlordId,
          complaint_id: expandedRow.complaintId,
          status: editStatus,
          staff_response: editResponse,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update complaint.");
      }
      setSuccess("Complaint updated.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
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

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Landlord
          </label>
          <select
            className={inputClassName}
            value={selectedLandlordId ?? ""}
            onChange={(event) => handleLandlordChange(event.target.value)}
          >
            <option value="">Select landlord…</option>
            {landlords.map((row) => (
              <option key={row.tenantId} value={row.tenantId}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Status
          </label>
          <select
            className={inputClassName}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            disabled={!selectedLandlordId}
          >
            <option value="">All</option>
            {LESSEE_COMPLAINT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedLandlordId ? (
        <p className="text-sm text-slate-600">
          Select a Davors-managed landlord to view tenant complaints.
        </p>
      ) : (
        <>
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Tenant</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Subject</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Reported</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No complaints for this landlord
                      {statusFilter ? " with the selected status" : ""}.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr
                      key={row.complaintId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {row.lesseeName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitLabel}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-sm text-slate-700">
                        <span className="line-clamp-2">{row.subject}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLesseeComplaintStatus(row.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatLesseeComplaintDate(row.dateReported)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={() =>
                            expandedId === row.complaintId
                              ? setExpandedId(null)
                              : openDetail(row)
                          }
                        >
                          {expandedId === row.complaintId ? "Close" : "Open"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {expandedRow ? (
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-[#0f2744]">
                {expandedRow.subject}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {expandedRow.lesseeName} · {expandedRow.unitLabel}
              </p>
              <p className="mt-4 whitespace-pre-wrap text-sm text-slate-800">
                {expandedRow.description}
              </p>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Status
                  </label>
                  <select
                    className={inputClassName}
                    value={editStatus}
                    onChange={(event) =>
                      setEditStatus(
                        event.target.value as LesseeComplaintStatus,
                      )
                    }
                  >
                    {LESSEE_COMPLAINT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Staff response
                  </label>
                  <textarea
                    className={textareaClassName}
                    rows={4}
                    value={editResponse}
                    onChange={(event) => setEditResponse(event.target.value)}
                    placeholder="Optional reply to the tenant…"
                  />
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  className={primaryButtonClassName}
                  disabled={loading}
                  onClick={() => void handleSave()}
                >
                  {loading ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
