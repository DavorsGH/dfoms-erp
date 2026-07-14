"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "./hr-register-utils";
import type { HrEmployee } from "./employee-utils";
import type {
  EmployeeLeaveBalance,
  LeaveType,
} from "../self-service/leave-request-utils";

type LeaveBalancesProps = {
  initialBalances: EmployeeLeaveBalance[];
  employees: HrEmployee[];
  leaveTypes: LeaveType[];
  currentYear: number;
  canManage: boolean;
  fetchError: string | null;
};

export default function LeaveBalances({
  initialBalances,
  employees,
  leaveTypes,
  currentYear,
  canManage,
  fetchError,
}: LeaveBalancesProps) {
  const supabase = createClient();
  const [balances, setBalances] = useState(initialBalances);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState("");
  const [entitledDays, setEntitledDays] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  const filteredBalances = useMemo(() => {
    if (!selectedEmployeeId) {
      return balances;
    }

    return balances.filter(
      (balance) => balance.employee_id === selectedEmployeeId,
    );
  }, [balances, selectedEmployeeId]);

  async function refreshBalances() {
    const { data, error: refreshError } = await supabase
      .from("employee_leave_balances")
      .select("*, leave_types(type_name), employees(full_name, staff_id)")
      .eq("year", currentYear)
      .order("employee_id");

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setBalances((data as EmployeeLeaveBalance[] | null) ?? []);
    setError(null);
  }

  async function handleSaveBalance() {
    if (!selectedEmployeeId || !selectedLeaveTypeId || entitledDays === "") {
      setError("Employee, leave type, and entitled days are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/leave/adjust-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: selectedEmployeeId,
          leave_type_id: selectedLeaveTypeId,
          year: currentYear,
          entitled_days: Number(entitledDays),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to adjust leave balance");
      }

      setSuccess("Leave balance updated.");
      await refreshBalances();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to adjust leave balance",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        HR/Admin override tool for employee leave entitlements (e.g. partial-year
        hires or manual corrections). Annual Leave default entitlement is
        pending confirmation from David.
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

      {canManage ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Adjust Leave Balance
          </h3>
          <div className="grid gap-4 md:grid-cols-4">
            <select
              value={selectedEmployeeId}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select employee</option>
              {employees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.staff_id} — {employee.full_name}
                </option>
              ))}
            </select>

            <select
              value={selectedLeaveTypeId}
              onChange={(event) => setSelectedLeaveTypeId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.type_name}
                </option>
              ))}
            </select>

            <input
              type="number"
              min="0"
              step="0.5"
              value={entitledDays}
              onChange={(event) => setEntitledDays(event.target.value)}
              className={inputClassName}
              placeholder="Entitled days"
            />

            <button
              type="button"
              onClick={() => void handleSaveBalance()}
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save Balance"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Leave Balances ({currentYear})
          </h3>
          <select
            value={selectedEmployeeId}
            onChange={(event) => setSelectedEmployeeId(event.target.value)}
            className={inputClassName}
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.staff_id} — {employee.full_name}
              </option>
            ))}
          </select>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Employee</th>
                <th className={scrollableTableThClassName}>Leave Type</th>
                <th className={scrollableTableThClassName}>Entitled</th>
                <th className={scrollableTableThClassName}>Used</th>
                <th className={scrollableTableThClassName}>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {filteredBalances.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No leave balances found.
                  </td>
                </tr>
              ) : (
                filteredBalances.map((balance) => (
                  <tr key={balance.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-sm text-slate-900">
                      {(balance as EmployeeLeaveBalance & {
                        employees?: { staff_id: string; full_name: string };
                      }).employees?.staff_id}{" "}
                      —{" "}
                      {(balance as EmployeeLeaveBalance & {
                        employees?: { staff_id: string; full_name: string };
                      }).employees?.full_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {balance.leave_types?.type_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {balance.entitled_days}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {balance.days_used}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {balance.days_remaining}
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
