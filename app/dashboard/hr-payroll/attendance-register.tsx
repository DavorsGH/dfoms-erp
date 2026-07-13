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
import {
  getEmployeeByStaffId,
  type HrEmployee,
} from "./employee-utils";
import {
  ATTENDANCE_STATUS_OPTIONS,
  DEFAULT_ATTENDANCE_STATUS,
  type AttendanceRegisterEntry,
} from "./attendance-register-utils";
import AttendanceBulkImport from "./attendance-bulk-import";
import {
  calculateHoursFromClock,
  formatDate,
  formatTime,
  inputClassName,
  toTimeInputValue,
} from "./hr-register-utils";

type AttendanceRegisterProps = {
  initialEntries: AttendanceRegisterEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  staff_id: "",
  employment_type: "",
  project_assignment: "",
  clock_in: "",
  clock_out: "",
  hours_worked: "",
  overtime_hours: "",
  attendance_status: DEFAULT_ATTENDANCE_STATUS,
};

export default function AttendanceRegister({
  initialEntries,
  initialEmployees,
  fetchError,
}: AttendanceRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees, setEmployees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const employeeNameByStaffId = useMemo(() => {
    return new Map(employees.map((employee) => [employee.staff_id, employee.full_name]));
  }, [employees]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("attendance_register")
      .select("*")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as AttendanceRegisterEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setShowBulkImport(false);
    setEditingId(null);
    setForm({ ...emptyForm, attendance_status: DEFAULT_ATTENDANCE_STATUS });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openBulkImport() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setShowBulkImport(true);
  }

  function closeBulkImport() {
    setShowBulkImport(false);
  }

  function openEditForm(entry: AttendanceRegisterEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      staff_id: entry.staff_id,
      employment_type: entry.employment_type ?? "",
      project_assignment: entry.project_assignment ?? "",
      clock_in: toTimeInputValue(entry.clock_in),
      clock_out: toTimeInputValue(entry.clock_out),
      hours_worked:
        entry.hours_worked === null ? "" : String(entry.hours_worked),
      overtime_hours:
        entry.overtime_hours === null ? "" : String(entry.overtime_hours),
      attendance_status: entry.attendance_status || DEFAULT_ATTENDANCE_STATUS,
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "staff_id") {
        const employee = getEmployeeByStaffId(employees, value);
        next.employment_type = employee?.employment_type ?? "";
        next.project_assignment = employee?.contract_project ?? "";
      }

      if (field === "clock_in" || field === "clock_out") {
        const calculated = calculateHoursFromClock(
          field === "clock_in" ? value : next.clock_in,
          field === "clock_out" ? value : next.clock_out,
        );

        if (calculated !== null) {
          next.hours_worked = String(calculated);
        }
      }

      return next;
    });
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("attendance_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      date: form.date,
      staff_id: form.staff_id,
      employment_type: form.employment_type || null,
      project_assignment: form.project_assignment || null,
      clock_in: form.clock_in || null,
      clock_out: form.clock_out || null,
      hours_worked: form.hours_worked ? Number(form.hours_worked) : null,
      overtime_hours: form.overtime_hours ? Number(form.overtime_hours) : null,
      attendance_status: form.attendance_status || DEFAULT_ATTENDANCE_STATUS,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("attendance_register")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("attendance_register").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Record daily attendance, clock times, and status by staff member.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (showBulkImport ? closeBulkImport() : openBulkImport())}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </button>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Entry"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showBulkImport ? (
        <AttendanceBulkImport
          employees={employees}
          existingEntries={entries}
          onClose={closeBulkImport}
          onImported={refreshEntries}
        />
      ) : null}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Attendance Entry" : "New Attendance Entry"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Staff ID
                </label>
                <select
                  required
                  value={form.staff_id}
                  onChange={(e) => updateField("staff_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select staff member</option>
                  {employees.map((employee) => (
                    <option key={employee.staff_id} value={employee.staff_id}>
                      {employee.staff_id} — {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employee Name
                </label>
                <input
                  type="text"
                  readOnly
                  value={
                    employeeNameByStaffId.get(form.staff_id) ?? ""
                  }
                  className={`${inputClassName} bg-slate-50`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employment Type
                </label>
                <input
                  type="text"
                  readOnly
                  value={form.employment_type}
                  className={`${inputClassName} bg-slate-50`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Project Assignment
                </label>
                <input
                  type="text"
                  readOnly
                  value={form.project_assignment}
                  className={`${inputClassName} bg-slate-50`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Clock In
                </label>
                <input
                  type="time"
                  value={form.clock_in}
                  onChange={(e) => updateField("clock_in", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Clock Out
                </label>
                <input
                  type="time"
                  value={form.clock_out}
                  onChange={(e) => updateField("clock_out", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Hours Worked
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hours_worked}
                  onChange={(e) => updateField("hours_worked", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Overtime Hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.overtime_hours}
                  onChange={(e) =>
                    updateField("overtime_hours", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Attendance Status
                </label>
                <select
                  required
                  value={form.attendance_status}
                  onChange={(e) =>
                    updateField("attendance_status", e.target.value)
                  }
                  className={inputClassName}
                >
                  {ATTENDANCE_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Entry"}
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
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Staff ID</th>
              <th className={scrollableTableThClassName}>Employee Name</th>
              <th className={scrollableTableThClassName}>Employment Type</th>
              <th className={scrollableTableThClassName}>Project</th>
              <th className={scrollableTableThClassName}>Clock In</th>
              <th className={scrollableTableThClassName}>Clock Out</th>
              <th className={scrollableTableThClassName}>Hours Worked</th>
              <th className={scrollableTableThClassName}>Overtime Hours</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No attendance entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">{entry.staff_id}</td>
                  <td className="px-4 py-3">
                    {employeeNameByStaffId.get(entry.staff_id) ?? "—"}
                  </td>
                  <td className="px-4 py-3">{entry.employment_type ?? "—"}</td>
                  <td className="px-4 py-3">{entry.project_assignment ?? "—"}</td>
                  <td className="px-4 py-3">{formatTime(entry.clock_in)}</td>
                  <td className="px-4 py-3">{formatTime(entry.clock_out)}</td>
                  <td className="px-4 py-3">{entry.hours_worked ?? "—"}</td>
                  <td className="px-4 py-3">{entry.overtime_hours ?? "—"}</td>
                  <td className="px-4 py-3">{entry.attendance_status}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.id)}
                    deleting={deletingId === entry.id}
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
