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
import FilteredListCount from "../filtered-list-count";
import {
  getEmployeeByStaffId,
  type HrEmployee,
} from "./employee-utils";
import {
  ATTENDANCE_MONTH_OPTIONS,
  ATTENDANCE_STATUS_OPTIONS,
  DEFAULT_ATTENDANCE_STATUS,
  buildAttendanceYearOptions,
  defaultAttendanceDateForMonth,
  getAttendanceMonthBounds,
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
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useWriteQueueOptional } from "@/components/write-queue-provider";
import { enqueueWriteQueueItem } from "@/lib/offline-write-queue/store";
import type { AttendanceQueuePayload } from "@/lib/offline-write-queue/types";
import { resolveClientCacheSession } from "@/lib/client-cache/session-context";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type AttendanceRegisterProps = {
  initialEntries: AttendanceRegisterEntry[];
  initialEmployees: HrEmployee[];
  initialYear: number;
  initialMonth: number;
  fetchError: string | null;
  /** Workspace id for staff-linked BU scoping on refresh. */
  tenantId?: string | null;
};

type DisplayAttendanceEntry = AttendanceRegisterEntry & {
  pendingSync?: boolean;
  queueFailed?: boolean;
  queueError?: string | null;
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
  initialYear,
  initialMonth,
  fetchError,
  tenantId = null,
}: AttendanceRegisterProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const isOnline = useOnlineStatus();
  const writeQueue = useWriteQueueOptional();
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [entries, setEntries] = useState(initialEntries);
  const [employees, setEmployees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImportExisting, setBulkImportExisting] = useState<
    Pick<AttendanceRegisterEntry, "date" | "staff_id">[]
  >([]);
  const [error, setError] = useState<string | null>(fetchError);

  const yearOptions = useMemo(() => buildAttendanceYearOptions(), []);

  const employeeNameByStaffId = useMemo(() => {
    return new Map(employees.map((employee) => [employee.staff_id, employee.full_name]));
  }, [employees]);

  const pendingAttendance = useMemo(() => {
    const items = writeQueue?.items ?? [];
    return items.filter((item) => item.type === "attendance");
  }, [writeQueue?.items]);

  const displayEntries = useMemo((): DisplayAttendanceEntry[] => {
    const { start, end } = getAttendanceMonthBounds(selectedYear, selectedMonth);
    const queued: DisplayAttendanceEntry[] = pendingAttendance
      .filter((item) => {
        const payload = item.payload as AttendanceQueuePayload;
        return payload.date >= start && payload.date <= end;
      })
      .map((item) => {
        const payload = item.payload as AttendanceQueuePayload;
        return {
          id: item.id,
          date: payload.date,
          staff_id: payload.staff_id,
          employment_type: payload.employment_type,
          project_assignment: payload.project_assignment,
          clock_in: payload.clock_in,
          clock_out: payload.clock_out,
          hours_worked: payload.hours_worked,
          overtime_hours: payload.overtime_hours,
          attendance_status: payload.attendance_status,
          pendingSync: true,
          queueFailed: item.status === "failed",
          queueError: item.lastError,
        };
      });
    return [...queued, ...entries];
  }, [entries, pendingAttendance, selectedYear, selectedMonth]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  async function loadEntriesForPeriod(year: number, month: number) {
    if (!isOnline) {
      setLoadingEntries(false);
      return;
    }
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      setLoadingEntries(false);
      return;
    }

    const { start, end } = getAttendanceMonthBounds(year, month);
    setLoadingEntries(true);

    const scoped = await fetchScopedStaffIds(supabase, tenantId, buReadScope);
    if (scoped.error) {
      setError(scoped.error);
      setLoadingEntries(false);
      return;
    }

    const { data, error: refreshError } = await applyStaffIdScope(
      supabase
        .from("attendance_register")
        .select("*")
        .gte("date", start)
        .lte("date", end),
      scoped.staffIds,
    ).order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      setLoadingEntries(false);
      return;
    }

    setEntries((data as AttendanceRegisterEntry[] | null) ?? []);
    setError(null);
    setLoadingEntries(false);
  }

  async function refreshEntries() {
    await loadEntriesForPeriod(selectedYear, selectedMonth);
    await writeQueue?.refresh();
  }

  function handleMonthChange(month: number) {
    setSelectedMonth(month);
    void loadEntriesForPeriod(selectedYear, month);
  }

  function handleYearChange(year: number) {
    setSelectedYear(year);
    void loadEntriesForPeriod(year, selectedMonth);
  }

  function openAddForm() {
    setShowBulkImport(false);
    setEditingId(null);
    setForm({
      ...emptyForm,
      date: defaultAttendanceDateForMonth(selectedYear, selectedMonth),
      attendance_status: DEFAULT_ATTENDANCE_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  async function openBulkImport() {
    if (!isOnline) {
      setError("Bulk import requires a connection.");
      return;
    }
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError(null);

    const scoped = await fetchScopedStaffIds(supabase, tenantId, buReadScope);
    if (scoped.error) {
      setError(scoped.error);
      return;
    }

    const { data, error: existingError } = await applyStaffIdScope(
      supabase.from("attendance_register").select("date, staff_id"),
      scoped.staffIds,
    );

    if (existingError) {
      setError(existingError.message);
      return;
    }

    setBulkImportExisting(
      (data as Pick<AttendanceRegisterEntry, "date" | "staff_id">[] | null) ??
        [],
    );
    setShowBulkImport(true);
  }

  function closeBulkImport() {
    setShowBulkImport(false);
    setBulkImportExisting([]);
  }

  function openEditForm(entry: DisplayAttendanceEntry) {
    if (entry.pendingSync) {
      setError(
        "Queued offline entries sync as recorded. Discard and re-add to change them.",
      );
      return;
    }
    if (!isOnline) {
      setError("Editing saved attendance requires a connection.");
      return;
    }
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

  async function handleDelete(entry: DisplayAttendanceEntry) {
    if (entry.pendingSync) {
      if (!confirmDeleteEntry()) return;
      setDeletingId(entry.id);
      await writeQueue?.discardItem(entry.id);
      setDeletingId(null);
      return;
    }

    if (!isOnline) {
      setError("Deleting saved attendance requires a connection.");
      return;
    }

    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(entry.id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("attendance_register")
      .delete()
      .eq("id", entry.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === entry.id) {
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

    const offlineNow = !isOnline || !navigator.onLine;
    if (offlineNow) {
      if (editingId) {
        setError("Editing saved attendance requires a connection.");
        setLoading(false);
        return;
      }
      const session =
        writeQueue?.session ?? (await resolveClientCacheSession());
      if (!session) {
        setError("Unable to queue offline — session not available.");
        setLoading(false);
        return;
      }
      const staffName = employeeNameByStaffId.get(form.staff_id) ?? null;
      await enqueueWriteQueueItem({
        session,
        type: "attendance",
        payload: { ...payload, staff_name: staffName },
      });
      await writeQueue?.refresh();
      closeForm();
      setLoading(false);
      return;
    }

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[160px]">
            <label
              htmlFor="attendance-month"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Month
            </label>
            <select
              id="attendance-month"
              value={selectedMonth}
              onChange={(event) =>
                handleMonthChange(Number(event.target.value))
              }
              className={inputClassName}
            >
              {ATTENDANCE_MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label
              htmlFor="attendance-year"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Year
            </label>
            <select
              id="attendance-year"
              value={selectedYear}
              onChange={(event) =>
                handleYearChange(Number(event.target.value))
              }
              className={inputClassName}
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              showBulkImport ? closeBulkImport() : void openBulkImport()
            }
            disabled={!isOnline && !showBulkImport}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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

      {!isOnline ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Offline — new attendance is saved to the sync queue. Edits/deletes of
          confirmed rows need a connection.
        </p>
      ) : null}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showBulkImport ? (
        <AttendanceBulkImport
          employees={employees}
          existingEntries={bulkImportExisting}
          onClose={closeBulkImport}
          onImported={refreshEntries}
        />
      ) : null}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Attendance Entry" : "New Attendance Entry"}
            {!isOnline && !editingId ? (
              <span className="ml-2 text-sm font-normal text-amber-800">
                (will queue until online)
              </span>
            ) : null}
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
                  Employment Type
                </label>
                <input
                  type="text"
                  value={form.employment_type}
                  onChange={(e) => updateField("employment_type", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Project Assignment
                </label>
                <input
                  type="text"
                  value={form.project_assignment}
                  onChange={(e) =>
                    updateField("project_assignment", e.target.value)
                  }
                  className={inputClassName}
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
                {loading
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : isOnline
                      ? "Add Entry"
                      : "Queue Entry"}
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

      <FilteredListCount
        filteredCount={displayEntries.length}
        totalCount={displayEntries.length}
        itemSingular="entry"
      />

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
            {displayEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {loadingEntries
                    ? "Loading attendance entries…"
                    : "No attendance entries for this month."}
                </td>
              </tr>
            ) : (
              displayEntries.map((entry, index) => (
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
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <span>{entry.attendance_status}</span>
                      {entry.pendingSync ? (
                        <span
                          className={`inline-flex w-fit rounded px-1.5 py-0.5 text-xs font-medium ${
                            entry.queueFailed
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-900"
                          }`}
                          title={entry.queueError ?? undefined}
                        >
                          {entry.queueFailed ? "Sync failed" : "Pending sync"}
                        </span>
                      ) : null}
                      {entry.queueFailed && writeQueue ? (
                        <button
                          type="button"
                          className="text-left text-xs font-medium text-sky-800 underline"
                          onClick={() => void writeQueue.retryItem(entry.id)}
                        >
                          Retry
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry)}
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
