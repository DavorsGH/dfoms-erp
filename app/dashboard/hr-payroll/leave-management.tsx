"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import {
  APPROVAL_STATUS_OPTIONS,
  DEFAULT_APPROVAL_STATUS,
  LEAVE_TYPE_OPTIONS,
  type LeaveManagementEntry,
} from "./leave-management-utils";
import {
  calculateDaysBetween,
  formatDate,
  inputClassName,
} from "./hr-register-utils";
import { allocateLeaveId } from "./hr-ids-api";

type LeaveManagementProps = {
  initialEntries: LeaveManagementEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  employee_id: "",
  leave_type: "",
  start_date: "",
  end_date: "",
  days_requested: "",
  days_approved: "",
  approval_status: DEFAULT_APPROVAL_STATUS,
  leave_balance_remaining: "",
};

export default function LeaveManagement({
  initialEntries,
  initialEmployees,
  fetchError,
}: LeaveManagementProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [deletingLeaveId, setDeletingLeaveId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterEmployee, setFilterEmployee] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filterEmployee && entry.employee_id !== filterEmployee) {
        return false;
      }

      if (filterStatus && entry.approval_status !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [entries, filterEmployee, filterStatus]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("leave_management")
      .select("*")
      .order("start_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as LeaveManagementEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingLeaveId(null);
    setForm({ ...emptyForm, approval_status: DEFAULT_APPROVAL_STATUS });
    setShowForm(true);
  }

  function closeForm() {
    setEditingLeaveId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: LeaveManagementEntry) {
    setEditingLeaveId(entry.leave_id);
    setForm({
      employee_id: entry.employee_id,
      leave_type: entry.leave_type,
      start_date: toDateInputValue(entry.start_date),
      end_date: toDateInputValue(entry.end_date),
      days_requested: String(entry.days_requested),
      days_approved:
        entry.days_approved === null ? "" : String(entry.days_approved),
      approval_status: entry.approval_status || DEFAULT_APPROVAL_STATUS,
      leave_balance_remaining:
        entry.leave_balance_remaining === null
          ? ""
          : String(entry.leave_balance_remaining),
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "start_date" || field === "end_date") {
        const startDate = field === "start_date" ? value : next.start_date;
        const endDate = field === "end_date" ? value : next.end_date;
        const calculatedDays = calculateDaysBetween(startDate, endDate);

        if (calculatedDays > 0) {
          next.days_requested = String(calculatedDays);
        }
      }

      return next;
    });
  }

  async function handleDelete(leaveId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingLeaveId(leaveId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("leave_management")
      .delete()
      .eq("leave_id", leaveId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingLeaveId(null);
      return;
    }

    if (editingLeaveId === leaveId) {
      closeForm();
    }

    await refreshEntries();
    setDeletingLeaveId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      employee_id: form.employee_id,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      days_requested: Number(form.days_requested) || 0,
      days_approved: form.days_approved ? Number(form.days_approved) : null,
      approval_status: form.approval_status || DEFAULT_APPROVAL_STATUS,
      leave_balance_remaining: form.leave_balance_remaining
        ? Number(form.leave_balance_remaining)
        : null,
    };

    if (editingLeaveId) {
      const { error: saveError } = await supabase
        .from("leave_management")
        .update(payload)
        .eq("leave_id", editingLeaveId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateLeaveId(supabase);
      if (allocated.error || !allocated.leaveId) {
        setError(allocated.error ?? "Unable to allocate leave ID.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("leave_management")
        .insert({ leave_id: allocated.leaveId, ...payload });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Manage leave requests, approvals, and remaining balances.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Employee
          </label>
          <select
            value={filterEmployee}
            onChange={(e) => setFilterEmployee(e.target.value)}
            className={inputClassName}
          >
            <option value="">All employees</option>
            {employees.map((employee) => (
              <option key={employee.employee_id} value={employee.employee_id}>
                {employee.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Filter by Approval Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={inputClassName}
          >
            <option value="">All statuses</option>
            {APPROVAL_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingLeaveId ? "Edit Leave Request" : "New Leave Request"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employee
                </label>
                <select
                  required
                  value={form.employee_id}
                  onChange={(e) => updateField("employee_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option
                      key={employee.employee_id}
                      value={employee.employee_id}
                    >
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Leave Type
                </label>
                <select
                  required
                  value={form.leave_type}
                  onChange={(e) => updateField("leave_type", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select leave type</option>
                  {LEAVE_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Start Date
                </label>
                <input
                  type="date"
                  required
                  value={form.start_date}
                  onChange={(e) => updateField("start_date", e.target.value)}
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
                  onChange={(e) => updateField("end_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Days Requested
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  required
                  value={form.days_requested}
                  onChange={(e) =>
                    updateField("days_requested", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Days Approved
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.days_approved}
                  onChange={(e) => updateField("days_approved", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approval Status
                </label>
                <select
                  required
                  value={form.approval_status}
                  onChange={(e) =>
                    updateField("approval_status", e.target.value)
                  }
                  className={inputClassName}
                >
                  {APPROVAL_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Leave Balance Remaining
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.leave_balance_remaining}
                  onChange={(e) =>
                    updateField("leave_balance_remaining", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingLeaveId
                    ? "Save Changes"
                    : "Add Entry"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Leave ID</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Leave Type</th>
              <th className={scrollableTableThClassName}>Start Date</th>
              <th className={scrollableTableThClassName}>End Date</th>
              <th className={scrollableTableThClassName}>Days Requested</th>
              <th className={scrollableTableThClassName}>Days Approved</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Balance Remaining</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No leave entries match the current filters.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, index) => (
                <tr key={entry.leave_id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{entry.leave_id}</td>
                  <td className="px-4 py-3">
                    {getEmployeeDisplayName(employees, entry.employee_id)}
                  </td>
                  <td className="px-4 py-3">{entry.leave_type}</td>
                  <td className="px-4 py-3">{formatDate(entry.start_date)}</td>
                  <td className="px-4 py-3">{formatDate(entry.end_date)}</td>
                  <td className="px-4 py-3">{entry.days_requested}</td>
                  <td className="px-4 py-3">{entry.days_approved ?? "—"}</td>
                  <td className="px-4 py-3">{entry.approval_status}</td>
                  <td className="px-4 py-3">
                    {entry.leave_balance_remaining ?? "—"}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.leave_id)}
                    deleting={deletingLeaveId === entry.leave_id}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
