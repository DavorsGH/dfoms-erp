"use client";

import { useCallback, useEffect, useState } from "react";
import CentredMessageModal from "@/components/centred-message-modal";
import { useToast } from "@/components/feedback/feedback-context";
import DashboardButton from "@/components/dashboard-button";
import { notifyAttendanceApprovalsChanged } from "./attendance-approvals-count-badge";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type ApprovalRow = {
  id: string;
  request_type: "remote" | "outage";
  staff_id: string;
  employee_name?: string | null;
  work_date: string;
  clock_in: string;
  clock_out: string | null;
  location_note: string | null;
  reason: string | null;
  site_code: string | null;
};

function formatWhen(iso: string | null): string {
  if (!iso) {
    return "—";
  }
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Accra",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AttendanceApprovals() {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ApprovalRow[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/attendance/approvals");
    const body = (await response.json().catch(() => null)) as {
      requests?: ApprovalRow[];
      error?: string;
    } | null;
    if (!response.ok) {
      setError(body?.error ?? "Could not load attendance approvals.");
      return;
    }
    setRequests(body?.requests ?? []);
    setError(null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(requestId: string, action: "approve" | "reject") {
    setLoadingId(requestId);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/attendance/approvals/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: requestId,
          action,
          decision_note: notes[requestId] ?? "",
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (response.status === 409 && body?.code === "already_recorded") {
        setConflict(body.error ?? "Attendance already recorded for this day.");
        return;
      }
      if (!response.ok) {
        throw new Error(body?.error ?? `Could not ${action} the request.`);
      }
      const message = action === "approve" ? "Attendance approved" : "Request rejected";
      setSuccess(message);
      toast(message);
      notifyAttendanceApprovalsChanged();
      await load();
    } catch (decideError) {
      setError(
        decideError instanceof Error
          ? decideError.message
          : `Could not ${action} the request.`,
      );
    } finally {
      setLoadingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Approve remote and outage attendance assigned to you as leave approver.
        Directors and super admins can approve when no leave approver is set,
        including their own request.
      </p>
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>In</th>
              <th className={scrollableTableThClassName}>Out</th>
              <th className={scrollableTableThClassName}>Location</th>
              <th className={scrollableTableThClassName}>Note</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  No pending attendance requests.
                </td>
              </tr>
            ) : (
              requests.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    {row.employee_name ?? row.staff_id}
                  </td>
                  <td className="px-3 py-2 capitalize">{row.request_type}</td>
                  <td className="px-3 py-2">{row.work_date}</td>
                  <td className="px-3 py-2">{formatWhen(row.clock_in)}</td>
                  <td className="px-3 py-2">{formatWhen(row.clock_out)}</td>
                  <td className="px-3 py-2">
                    <div>{row.location_note?.trim() || "—"}</div>
                    {row.reason?.trim() ? (
                      <div className="text-xs text-slate-500">
                        Reason: {row.reason.trim()}
                      </div>
                    ) : null}
                    {row.site_code ? (
                      <div className="text-xs text-slate-500">{row.site_code}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="w-40 rounded-md border border-slate-300 px-2 py-1"
                      value={notes[row.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [row.id]: event.target.value,
                        }))
                      }
                      placeholder="Required to reject"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <DashboardButton
                        type="button"
                        disabled={loadingId === row.id}
                        onClick={() => void decide(row.id, "approve")}
                      >
                        Approve
                      </DashboardButton>
                      <DashboardButton
                        type="button"
                        variant="secondary"
                        disabled={loadingId === row.id}
                        onClick={() => void decide(row.id, "reject")}
                      >
                        Reject
                      </DashboardButton>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
      {conflict ? (
        <CentredMessageModal
          title="Attendance already recorded"
          message={conflict}
          onClose={() => setConflict(null)}
        />
      ) : null}
    </div>
  );
}
