"use client";

import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useRefetchOnWindowFocus } from "@/hooks/use-refetch-on-window-focus";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { fetchLeaveBalancesPageData } from "@/app/dashboard/hr-payroll/leave-balances-page-fetch";
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
  tenantId: string | null;
};

function balanceKey(employeeId: string, leaveTypeId: string) {
  return `${employeeId}:${leaveTypeId}`;
}

function formatBalanceCell(balance: EmployeeLeaveBalance | undefined): {
  display: string;
  title: string;
  hasActivity: boolean;
} {
  if (!balance) {
    return { display: "—", title: "No entitlement recorded", hasActivity: false };
  }
  const used = Number(balance.days_used) || 0;
  const entitled = Number(balance.entitled_days) || 0;
  const remaining = Number(balance.days_remaining) || 0;
  if (used === 0 && entitled === 0 && remaining === 0) {
    return { display: "—", title: "No entitlement recorded", hasActivity: false };
  }
  return {
    display: `${used} / ${entitled}`,
    title: `${remaining} day(s) remaining`,
    hasActivity: used > 0 || entitled > 0,
  };
}

export default function LeaveBalances({
  initialBalances,
  employees,
  leaveTypes,
  currentYear,
  canManage,
  fetchError,
  tenantId,
}: LeaveBalancesProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const [balances, setBalances] = useState(initialBalances);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedLeaveTypeId, setSelectedLeaveTypeId] = useState("");
  const [entitledDays, setEntitledDays] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterLeaveTypeId, setFilterLeaveTypeId] = useState("");
  const [onlyWithLeaveTaken, setOnlyWithLeaveTaken] = useState(false);

  const sortedLeaveTypes = useMemo(
    () =>
      [...leaveTypes].sort((a, b) =>
        a.type_name.localeCompare(b.type_name, undefined, { sensitivity: "base" }),
      ),
    [leaveTypes],
  );

  const balanceByEmployeeType = useMemo(() => {
    const map = new Map<string, EmployeeLeaveBalance>();
    for (const row of balances) {
      map.set(balanceKey(row.employee_id, row.leave_type_id), row);
    }
    return map;
  }, [balances]);

  const refreshBalances = useCallback(async () => {
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }
    const result = await fetchLeaveBalancesPageData(
      supabase,
      tenantId,
      buReadScope,
      currentYear,
    );
    if (result.error) {
      setError(result.error);
      return;
    }
    setBalances(result.balances);
    setError(null);
  }, [buReadScope, currentYear, supabase, tenantId]);

  useRefetchOnWindowFocus(refreshBalances);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((employee) => {
      if (q) {
        const hay = `${employee.full_name} ${employee.staff_id}`.toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }

      const employeeBalances = sortedLeaveTypes.map((type) =>
        balanceByEmployeeType.get(balanceKey(employee.employee_id, type.id)),
      );

      if (filterLeaveTypeId) {
        const cell = balanceByEmployeeType.get(
          balanceKey(employee.employee_id, filterLeaveTypeId),
        );
        const used = Number(cell?.days_used) || 0;
        if (used <= 0) {
          return false;
        }
      }

      if (onlyWithLeaveTaken) {
        const anyUsed = employeeBalances.some(
          (b) => b && (Number(b.days_used) || 0) > 0,
        );
        if (!anyUsed) {
          return false;
        }
      }

      return true;
    });
  }, [
    balanceByEmployeeType,
    employees,
    filterLeaveTypeId,
    onlyWithLeaveTaken,
    search,
    sortedLeaveTypes,
  ]);

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
        View used and entitled days by employee and leave type for {currentYear}.
        Entitlements follow Administration → Leave Settings unless adjusted below.
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
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Leave Balances ({currentYear})
          </h3>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${inputClassName} min-w-[220px]`}
            placeholder="Search name or Staff ID"
          />
          <select
            value={filterLeaveTypeId}
            onChange={(event) => setFilterLeaveTypeId(event.target.value)}
            className={inputClassName}
          >
            <option value="">All leave types</option>
            {sortedLeaveTypes.map((type) => (
              <option key={type.id} value={type.id}>
                Has {type.type_name} taken
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyWithLeaveTaken}
              onChange={(event) => setOnlyWithLeaveTaken(event.target.checked)}
              className="rounded border-slate-300"
            />
            Only employees with leave taken
          </label>
        </div>

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={`${scrollableTableThClassName} sticky left-0 z-10 bg-slate-50`}>
                  Employee
                </th>
                <th className={scrollableTableThClassName}>Staff ID</th>
                {sortedLeaveTypes.map((type) => (
                  <th key={type.id} className={scrollableTableThClassName}>
                    {type.type_name}
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      used / entitled
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={2 + sortedLeaveTypes.length}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No employees match your filters.
                  </td>
                </tr>
              ) : (
                tableRows.map((employee) => (
                  <tr
                    key={employee.employee_id}
                    className="border-b border-slate-100"
                  >
                    <td className="sticky left-0 z-10 bg-white px-4 py-3 text-sm font-medium text-slate-900">
                      {employee.full_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {employee.staff_id}
                    </td>
                    {sortedLeaveTypes.map((type) => {
                      const cell = formatBalanceCell(
                        balanceByEmployeeType.get(
                          balanceKey(employee.employee_id, type.id),
                        ),
                      );
                      return (
                        <td
                          key={type.id}
                          className="px-4 py-3 text-sm text-slate-700"
                          title={cell.title}
                        >
                          <span>{cell.display}</span>
                          {cell.hasActivity ? (
                            <span className="mt-0.5 block text-xs text-slate-500">
                              {cell.title}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
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
