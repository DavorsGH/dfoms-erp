"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  calculateDaysBetween,
  formatDate,
  inputClassName,
} from "../hr-payroll/hr-register-utils";
import type {
  EmployeeLeaveBalance,
  LeaveRequest,
  LeaveType,
} from "./leave-request-utils";

type MyLeaveProps = {
  initialBalances: EmployeeLeaveBalance[];
  initialRequests: LeaveRequest[];
  leaveTypes: LeaveType[];
  currentYear: number;
  fetchError: string | null;
};

const emptyForm = {
  leave_type_id: "",
  start_date: "",
  end_date: "",
  reason: "",
};

export default function MyLeave({
  initialBalances,
  initialRequests,
  leaveTypes,
  currentYear,
  fetchError,
}: MyLeaveProps) {
  const supabase = createClient();
  const [balances, setBalances] = useState(initialBalances);
  const [requests, setRequests] = useState(initialRequests);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  const calculatedDays = useMemo(() => {
    return calculateDaysBetween(form.start_date, form.end_date);
  }, [form.start_date, form.end_date]);

  const selectedBalance = balances.find(
    (balance) => balance.leave_type_id === form.leave_type_id,
  );

  const wouldExceed =
    selectedBalance != null &&
    calculatedDays > 0 &&
    calculatedDays > Number(selectedBalance.days_remaining);

  async function refreshData() {
    const [{ data: balanceRows }, { data: requestRows }] = await Promise.all([
      supabase
        .from("employee_leave_balances")
        .select("*, leave_types(type_name)")
        .eq("year", currentYear)
        .order("leave_type_id"),
      supabase
        .from("leave_requests")
        .select("*, leave_types(type_name)")
        .order("submitted_at", { ascending: false }),
    ]);

    setBalances((balanceRows as EmployeeLeaveBalance[] | null) ?? []);
    setRequests((requestRows as LeaveRequest[] | null) ?? []);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/leave/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leave_type_id: form.leave_type_id,
          start_date: form.start_date,
          end_date: form.end_date,
          reason: form.reason,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        requestId?: string;
        exceedsBalance?: boolean;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to submit leave request");
      }

      setSuccess(
        payload.exceedsBalance
          ? "Leave request submitted. Note: this request exceeds your remaining balance and requires approver discretion."
          : "Leave request submitted successfully.",
      );
      setForm(emptyForm);
      setShowForm(false);
      await refreshData();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to submit leave request",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(requestId: string) {
    if (!window.confirm("Cancel this pending leave request?")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/leave/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to cancel leave request");
      }

      setSuccess("Leave request cancelled.");
      await refreshData();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : "Failed to cancel leave request",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
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

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Leave Balance ({currentYear})
        </h3>
        <p className="mb-4 text-xs text-amber-700">
          Annual Leave entitlement is pending confirmation from management
          (Ghana Labour Act standard — flagged for David).
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {balances.map((balance) => (
            <div
              key={balance.id}
              className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <p className="text-sm font-medium text-[#0f2744]">
                {balance.leave_types?.type_name ?? "Leave"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Entitled: {balance.entitled_days} · Used: {balance.days_used} ·
                Remaining: {balance.days_remaining}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-[#0f2744]">Request Leave</h3>
          <button
            type="button"
            onClick={() => setShowForm((current) => !current)}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
          >
            {showForm ? "Close Form" : "Request Leave"}
          </button>
        </div>

        {showForm ? (
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Leave Type
              </label>
              <select
                required
                value={form.leave_type_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    leave_type_id: event.target.value,
                  }))
                }
                className={inputClassName}
              >
                <option value="">Select leave type</option>
                {leaveTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.type_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Days Requested
              </label>
              <input
                readOnly
                value={calculatedDays > 0 ? String(calculatedDays) : ""}
                className={inputClassName}
                placeholder="Auto-calculated from dates"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Start Date
              </label>
              <input
                type="date"
                required
                value={form.start_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    start_date: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                End Date
              </label>
              <input
                type="date"
                required
                value={form.end_date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    end_date: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Reason
              </label>
              <textarea
                value={form.reason}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                rows={3}
                className={inputClassName}
                placeholder="Optional reason for your leave request"
              />
            </div>

            {wouldExceed ? (
              <div className="md:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                This request exceeds your remaining balance. It can still be
                submitted for approver review (warn-but-allow default).
              </div>
            ) : null}

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={loading || calculatedDays <= 0}
                className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
              >
                {loading ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
          My Leave Requests
        </h3>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Dates</th>
                <th className={scrollableTableThClassName}>Days</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Submitted</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No leave requests yet.
                  </td>
                </tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-sm text-slate-900">
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
                      {request.status}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatDate(request.submitted_at)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {request.status === "Pending" ? (
                        <button
                          type="button"
                          onClick={() => void handleCancel(request.id)}
                          disabled={loading}
                          className="text-sm font-medium text-red-700 hover:text-red-900"
                        >
                          Cancel
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
