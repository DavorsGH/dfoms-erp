"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import type { LeaveRequest } from "../self-service/leave-request-utils";

type LeaveApprovalsProps = {
  initialRequests: LeaveRequest[];
  fetchError: string | null;
};

export default function LeaveApprovals({
  initialRequests,
  fetchError,
}: LeaveApprovalsProps) {
  const supabase = createClient();
  const [requests, setRequests] = useState(initialRequests);
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  async function refreshRequests() {
    const { data, error: refreshError } = await supabase
      .from("leave_requests")
      .select(
        "*, leave_types(type_name), employees!leave_requests_employee_id_fkey(full_name, staff_id)",
      )
      .eq("status", "Pending")
      .order("submitted_at", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setRequests((data as LeaveRequest[] | null) ?? []);
    setError(null);
  }

  async function handleDecision(
    requestId: string,
    action: "approve" | "reject",
  ) {
    setLoadingId(requestId);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/leave/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          decision_notes: notesById[requestId] ?? "",
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action} leave request`);
      }

      setSuccess(
        action === "approve"
          ? "Leave request approved."
          : "Leave request rejected.",
      );
      await refreshRequests();
    } catch (decisionError) {
      setError(
        decisionError instanceof Error
          ? decisionError.message
          : `Failed to ${action} leave request`,
      );
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Review pending leave requests assigned to you. Approving a request
        deducts days from the employee&apos;s leave balance.
      </p>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Dates</th>
              <th className={scrollableTableThClassName}>Days</th>
              <th className={scrollableTableThClassName}>Reason</th>
              <th className={scrollableTableThClassName}>Notes</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No pending leave requests.
                </td>
              </tr>
            ) : (
              requests.map((request) => (
                <tr key={request.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 text-sm text-slate-900">
                    {request.employees?.staff_id} —{" "}
                    {request.employees?.full_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {request.leave_types?.type_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatDate(request.start_date)} –{" "}
                    {formatDate(request.end_date)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {request.days_requested}
                    {request.exceeds_balance ? " ⚠" : ""}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {request.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <input
                      value={notesById[request.id] ?? ""}
                      onChange={(event) =>
                        setNotesById((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      className={inputClassName}
                      placeholder="Decision notes"
                    />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDecision(request.id, "approve")}
                        disabled={loadingId === request.id}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDecision(request.id, "reject")}
                        disabled={loadingId === request.id}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
