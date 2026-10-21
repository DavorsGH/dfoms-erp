"use client";

import Link from "next/link";
import Tooltip from "@/components/ui/tooltip";
import TimePickerField from "@/components/time-picker-field";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import {
  RegisterColumnFilterHeader,
  RegisterDateRangeFilterHeader,
  collectDistinctColumnValues,
  registerColumnSortConfig,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
  type RegisterDateRangeFilterValue,
} from "../finance/register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
import { downloadCsv } from "../reports/report-ui";
import {
  filterActiveEmployees,
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
import {
  ATTENDANCE_REGISTER_CSV_HEADERS,
  FORMER_STAFF_FILTER_SEPARATOR,
  attendanceFiltersFromSearchParams,
  attendanceFiltersToSearchParams,
  attendanceRegisterFiltersActive,
  buildAttendanceEmployeeFilterOptions,
  buildAttendancePersonMonthSummary,
  buildAttendanceRegisterCsvRows,
  defaultAttendanceRegisterSort,
  enrichAttendanceRegisterRows,
  filterAttendanceRegisterRows,
  payrollProcessingHrefForMonth,
  sortAttendanceRegisterRows,
  type AttendanceRegisterDisplayRow,
  type AttendanceRegisterFilters,
} from "./attendance-register-filters";
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
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { ATTENDANCE_CHANGED_EVENT, notifyAttendanceChanged } from "@/lib/attendance-changed";
import {
  decisionRequiredForStatusEdit,
  decisionSavedToast,
  exceptionDecisionLabel,
  type AttendanceExceptionDecision,
} from "@/lib/attendance-exception-decision";
import { attendanceExceptionBadges, isReviewedException } from "@/lib/shift-attendance";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type AttendanceRegisterProps = {
  initialEntries: AttendanceRegisterEntry[];
  initialEmployees: HrEmployee[];
  initialSiteNameByCode?: Record<string, string>;
  initialYear: number;
  initialMonth: number;
  fetchError: string | null;
  /** Workspace id for staff-linked BU scoping on refresh. */
  tenantId?: string | null;
  canDecide?: boolean;
};

type DisplayAttendanceEntry = AttendanceRegisterEntry & {
  pendingSync?: boolean;
  queueFailed?: boolean;
  queueError?: string | null;
};

function stripFormerStaffSeparator(
  next: RegisterColumnFilterValue,
): RegisterColumnFilterValue {
  if (!next) {
    return null;
  }
  const cleaned = new Set(
    [...next].filter((value) => value !== FORMER_STAFF_FILTER_SEPARATOR),
  );
  return cleaned.size > 0 ? cleaned : null;
}

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
  exception_status: "none",
};

export default function AttendanceRegister({
  initialEntries,
  initialEmployees,
  initialSiteNameByCode = {},
  initialYear,
  initialMonth,
  fetchError,
  tenantId = null,
  canDecide = false,
}: AttendanceRegisterProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const isOnline = useOnlineStatus();
  const writeQueue = useWriteQueueOptional();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlBootstrap = useMemo(
    () => attendanceFiltersFromSearchParams(searchParams),
    // Only seed from the first URL read; later edits push their own params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [selectedYear, setSelectedYear] = useState(
    urlBootstrap.year ?? initialYear,
  );
  const [selectedMonth, setSelectedMonth] = useState(
    urlBootstrap.month ?? initialMonth,
  );
  const [entries, setEntries] = useState(initialEntries);
  const [employees, setEmployees] = useState(initialEmployees);
  const [siteNameByCode, setSiteNameByCode] = useState(initialSiteNameByCode);
  const [filters, setFilters] = useState<AttendanceRegisterFilters>(
    urlBootstrap.filters,
  );
  const [sort, setSort] = useState<RegisterColumnSortState | null>(
    urlBootstrap.sort ?? defaultAttendanceRegisterSort(),
  );
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
  const [decisionTarget, setDecisionTarget] = useState<DisplayAttendanceEntry | null>(
    null,
  );
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionSaving, setDecisionSaving] = useState(false);
  const urlSyncReady = useRef(false);

  const yearOptions = useMemo(() => buildAttendanceYearOptions(), []);
  const activeEmployeesForForm = useMemo(
    () => filterActiveEmployees(employees),
    [employees],
  );

  const employeesByStaffId = useMemo(() => {
    return new Map(employees.map((employee) => [employee.staff_id, employee]));
  }, [employees]);

  const employeeNameByStaffId = useMemo(() => {
    return new Map(employees.map((employee) => [employee.staff_id, employee.full_name]));
  }, [employees]);

  const siteNameMap = useMemo(
    () => new Map(Object.entries(siteNameByCode)),
    [siteNameByCode],
  );

  const pendingAttendance = useMemo(() => {
    const items = writeQueue?.items ?? [];
    return items.filter((item) => item.type === "attendance");
  }, [writeQueue?.items]);

  const monthEntries = useMemo((): DisplayAttendanceEntry[] => {
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

  const enrichedRows = useMemo(
    () =>
      enrichAttendanceRegisterRows({
        entries: monthEntries,
        employeesByStaffId,
        siteNameByCode: siteNameMap,
      }),
    [employeesByStaffId, monthEntries, siteNameMap],
  );

  const filteredRows = useMemo(
    () => filterAttendanceRegisterRows(enrichedRows, filters),
    [enrichedRows, filters],
  );

  const displayEntries = useMemo(
    () => sortAttendanceRegisterRows(filteredRows, sort),
    [filteredRows, sort],
  );

  const personSummary = useMemo(
    () =>
      buildAttendancePersonMonthSummary(
        displayEntries,
        selectedYear,
        selectedMonth,
      ),
    [displayEntries, selectedMonth, selectedYear],
  );

  const hasActiveFilters = attendanceRegisterFiltersActive(filters);

  const employeeFilterOptions = useMemo(() => {
    const staffIds = new Set(enrichedRows.map((row) => row.staff_id));
    const present = employees.filter((employee) =>
      staffIds.has(employee.staff_id),
    );
    return buildAttendanceEmployeeFilterOptions(present);
  }, [employees, enrichedRows]);

  const contractOptions = useMemo(
    () => collectDistinctColumnValues(enrichedRows.map((row) => row.contractLabel)),
    [enrichedRows],
  );
  const siteOptions = useMemo(
    () => collectDistinctColumnValues(enrichedRows.map((row) => row.siteLabel)),
    [enrichedRows],
  );
  const shiftOptions = useMemo(
    () => collectDistinctColumnValues(enrichedRows.map((row) => row.shiftLabel)),
    [enrichedRows],
  );
  const employmentTypeOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        enrichedRows.map((row) => row.employmentTypeLabel),
      ),
    [enrichedRows],
  );
  const statusOptions = useMemo(
    () => collectDistinctColumnValues(enrichedRows.map((row) => row.statusLabel)),
    [enrichedRows],
  );
  const decisionOptions = useMemo(
    () =>
      collectDistinctColumnValues(enrichedRows.map((row) => row.decisionLabel)),
    [enrichedRows],
  );

  function columnSortConfig(
    columnId: string,
    valueType: RegisterColumnSortValueType,
  ) {
    return registerColumnSortConfig(columnId, valueType, sort, setSort);
  }

  function patchFilters(patch: Partial<AttendanceRegisterFilters>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  function syncUrl(
    year: number,
    month: number,
    nextFilters: AttendanceRegisterFilters,
    nextSort: RegisterColumnSortState | null,
  ) {
    const params = attendanceFiltersToSearchParams(
      year,
      month,
      nextFilters,
      nextSort,
    );
    // Preserve unrelated query keys (e.g. exceptions=pending).
    for (const [key, value] of searchParams.entries()) {
      if (
        ![
          "year",
          "month",
          "q",
          "employee",
          "contract",
          "site",
          "shift",
          "empType",
          "status",
          "decision",
          "dateFrom",
          "dateTo",
          "sort",
        ].includes(key)
      ) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  useEffect(() => {
    setSiteNameByCode(initialSiteNameByCode);
  }, [initialSiteNameByCode]);

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

  const refreshRef = useRef(refreshEntries);
  refreshRef.current = refreshEntries;
  useEffect(() => {
    const onChanged = () => {
      void refreshRef.current();
    };
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ATTENDANCE_CHANGED_EVENT, onChanged);
  }, []);

  useEffect(() => {
    if (!urlSyncReady.current) {
      urlSyncReady.current = true;
      if (
        urlBootstrap.year != null &&
        urlBootstrap.month != null &&
        (urlBootstrap.year !== initialYear ||
          urlBootstrap.month !== initialMonth)
      ) {
        void loadEntriesForPeriod(urlBootstrap.year, urlBootstrap.month);
      }
      return;
    }
    syncUrl(selectedYear, selectedMonth, filters, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth, filters, sort]);

  function handleMonthChange(month: number) {
    setSelectedMonth(month);
    void loadEntriesForPeriod(selectedYear, month);
  }

  function handleYearChange(year: number) {
    setSelectedYear(year);
    void loadEntriesForPeriod(year, selectedMonth);
  }

  function handleExportCsv() {
    const monthName =
      ATTENDANCE_MONTH_OPTIONS.find((option) => option.value === selectedMonth)
        ?.label ?? String(selectedMonth);
    const fileName = `attendance-${monthName}-${selectedYear}.csv`.replace(
      /\s+/g,
      "-",
    );
    const body = buildAttendanceRegisterCsvRows(displayEntries);
    const rows: Array<Array<string | number | null>> =       personSummary
        ? [[personSummary.summaryLine, ...Array(12).fill("")], ...body]
        : body;
    downloadCsv(fileName, [...ATTENDANCE_REGISTER_CSV_HEADERS], rows);
  }

  function handlePrint() {
    window.print();
  }

  function openAddForm() {
    setLoading(false);
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
    setLoading(false);
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
      exception_status: entry.exception_status || "none",
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
      if (!(await confirmDeleteEntry())) return;
      setDeletingId(entry.id);
      await writeQueue?.discardItem(entry.id);
      setDeletingId(null);
      return;
    }

    if (!isOnline) {
      setError("Deleting saved attendance requires a connection.");
      return;
    }

    if (!(await confirmDeleteEntry())) {
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
    toast("Attendance entry removed.");
    notifyAttendanceChanged();
    setDeletingId(null);
  }

  async function refuseIfPayrollLocked(date: string): Promise<boolean> {
    const response = await fetch("/api/attendance/payroll-lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    const payload = (await response.json()) as {
      error?: string;
      locked?: boolean;
      message?: string | null;
    };
    if (!response.ok) {
      setLoading(false);
      await alertError(new Error(payload.error ?? "Could not check payroll lock."));
      return true;
    }
    if (payload.locked) {
      setLoading(false);
      await alertError({
        message:
          payload.message ??
          "Payroll for this month is locked — unlock it first to change attendance.",
      });
      return true;
    }
    return false;
  }

  async function postDecision(
    id: string,
    decision: AttendanceExceptionDecision,
    note: string,
    attendanceStatus: string | null,
  ): Promise<boolean> {
    const response = await fetch("/api/attendance/exceptions/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        decision,
        note,
        attendanceStatus,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setLoading(false);
      setDecisionSaving(false);
      await alertError(new Error(payload.error ?? "Could not save the decision."));
      return false;
    }
    toast(decisionSavedToast(decision));
    return true;
  }

  async function saveDecisionChange(decision: AttendanceExceptionDecision) {
    if (!decisionTarget) {
      return;
    }
    setDecisionSaving(true);
    setError(null);
    const saved = await postDecision(
      decisionTarget.id,
      decision,
      decisionNote,
      decision === "absent" ? "Absent" : decisionTarget.attendance_status,
    );
    setDecisionSaving(false);
    if (!saved) {
      return;
    }
    setDecisionTarget(null);
    setDecisionNote("");
    notifyAttendanceChanged();
  }

  async function handleSubmit(
    e: React.FormEvent,
    decisionOverride?: AttendanceExceptionDecision,
  ) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
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
        return;
      }
      const session =
        writeQueue?.session ?? (await resolveClientCacheSession());
      if (!session) {
        setError("Unable to queue offline — session not available.");
        return;
      }
      const staffName = employeeNameByStaffId.get(form.staff_id) ?? null;
      await enqueueWriteQueueItem({
        session,
        type: "attendance",
        payload: { ...payload, staff_name: staffName },
      });
      try {
        await writeQueue?.refresh();
      } catch {
        // Queued row saved; queue badge refresh is non-blocking.
      }
      closeForm();
      toast("Attendance entry queued.");
      return;
    }

    if (await refuseIfPayrollLocked(payload.date)) {
      return;
    }

    let decisionToasted = false;
    if (editingId) {
      const needed = decisionRequiredForStatusEdit(
        form.exception_status,
        payload.attendance_status,
      );
      if (needed === "ask_full_or_half" && !decisionOverride) {
        setLoading(false);
        return;
      }
      const decision =
        needed === "ask_full_or_half" ? (decisionOverride ?? null) : needed;
      if (decision) {
        const saved = await postDecision(
          editingId,
          decision,
          "",
          payload.attendance_status,
        );
        if (!saved) {
          return;
        }
        decisionToasted = true;
      }
    }

    const { error: saveError } = editingId
      ? await supabase
          .from("attendance_register")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("attendance_register").insert(payload);

    if (saveError) {
      if (decisionToasted) {
        notifyAttendanceChanged();
      }
      setError(saveError.message);
      return;
    }

    if (!decisionToasted) {
      toast(editingId ? "Attendance saved." : "Attendance entry added.");
    }
    notifyAttendanceChanged();
    closeForm();
    await refreshEntries();
    } catch (unexpected) {
      setError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to save attendance.",
      );
    } finally {
      setLoading(false);
    }
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
          employees={activeEmployeesForForm}
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
                  {activeEmployeesForForm.map((employee) => (
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
                <TimePickerField
                  aria-label="Clock In"
                  value={form.clock_in}
                  onChange={(value) => updateField("clock_in", value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Clock Out
                </label>
                <TimePickerField
                  aria-label="Clock Out"
                  value={form.clock_out}
                  onChange={(value) => updateField("clock_out", value)}
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
                {editingId && form.exception_status !== "none" ? (
                  <p className="mt-2 text-sm text-slate-700">
                    Decision: {exceptionDecisionLabel(form.exception_status)}
                  </p>
                ) : null}
                {editingId &&
                decisionRequiredForStatusEdit(
                  form.exception_status,
                  form.attendance_status,
                ) === "absent" ? (
                  <p className="mt-1 text-sm text-slate-600">
                    Saving sets the decision to Absent.
                  </p>
                ) : null}
                {editingId &&
                decisionRequiredForStatusEdit(
                  form.exception_status,
                  form.attendance_status,
                ) === "ask_full_or_half" ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium text-slate-800">
                      Change decision to Full day or Half day?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void handleSubmit(
                            { preventDefault() {} } as React.FormEvent,
                            "full_day",
                          )
                        }
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] disabled:opacity-50"
                      >
                        Full day
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() =>
                          void handleSubmit(
                            { preventDefault() {} } as React.FormEvent,
                            "half_day",
                          )
                        }
                        className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] disabled:opacity-50"
                      >
                        Half day
                      </button>
                    </div>
                  </div>
                ) : null}
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

      {decisionTarget ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Change decision
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            {employeeNameByStaffId.get(decisionTarget.staff_id) ??
              decisionTarget.staff_id}{" "}
            · {formatDate(decisionTarget.date)} · Decision:{" "}
            {exceptionDecisionLabel(decisionTarget.exception_status)}
          </p>
          <label className="mt-4 mb-1 block text-sm font-medium text-slate-700">
            Note
          </label>
          <input
            type="text"
            value={decisionNote}
            onChange={(event) => setDecisionNote(event.target.value)}
            disabled={decisionSaving}
            className={inputClassName}
            aria-label="Decision note"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {(["full_day", "half_day", "absent"] as const).map((decision) => (
              <button
                key={decision}
                type="button"
                disabled={decisionSaving}
                onClick={() => void saveDecisionChange(decision)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-[#0f2744] disabled:opacity-50"
              >
                {exceptionDecisionLabel(decision)}
              </button>
            ))}
            <button
              type="button"
              disabled={decisionSaving}
              onClick={() => {
                setDecisionTarget(null);
                setDecisionNote("");
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="attendance-register-search"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Search
          </label>
          <input
            id="attendance-register-search"
            type="search"
            value={filters.search}
            onChange={(event) => patchFilters({ search: event.target.value })}
            placeholder="Employee name or staff ID"
            className={inputClassName}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={displayEntries.length === 0}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={displayEntries.length === 0}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Print
          </button>
        </div>
      </div>

      {personSummary ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <p className="font-medium">{personSummary.summaryLine}</p>
          <Link
            href={payrollProcessingHrefForMonth(selectedYear, selectedMonth)}
            className="mt-1 inline-block font-medium text-sky-800 underline"
          >
            View payroll for {personSummary.monthLabel}
          </Link>
        </div>
      ) : null}

      <FilteredListCount
        filteredCount={displayEntries.length}
        totalCount={enrichedRows.length}
        itemSingular="entry"
        hasActiveFilters={
          hasActiveFilters ||
          anyRegisterColumnFiltersActive(
            filters.employee,
            filters.contract,
            filters.site,
            filters.shift,
            filters.employmentType,
            filters.status,
            filters.decision,
            filters.dateRange,
          )
        }
      />

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #attendance-register-print-area,
          #attendance-register-print-area * { visibility: visible; }
          #attendance-register-print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 16px;
            background: white;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      <div id="attendance-register-print-area">
        {personSummary ? (
          <p className="mb-3 hidden text-sm font-medium text-slate-900 print:block">
            {personSummary.summaryLine}
          </p>
        ) : null}
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>
                  <RegisterDateRangeFilterHeader
                    label="Date"
                    applied={filters.dateRange}
                    onApply={(next: RegisterDateRangeFilterValue) =>
                      patchFilters({ dateRange: next })
                    }
                    sort={columnSortConfig("date", "date")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Employee"
                    options={employeeFilterOptions}
                    applied={filters.employee}
                    onApply={(next) =>
                      patchFilters({
                        employee: stripFormerStaffSeparator(next),
                      })
                    }
                    sort={columnSortConfig("employee", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <AttendanceSortableHeader
                    label="Staff ID"
                    columnId="staff_id"
                    valueType="text"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Employment Type"
                    options={employmentTypeOptions}
                    applied={filters.employmentType}
                    onApply={(next) =>
                      patchFilters({ employmentType: next })
                    }
                    sort={columnSortConfig("employment_type", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Contract"
                    options={contractOptions}
                    applied={filters.contract}
                    onApply={(next) => patchFilters({ contract: next })}
                    sort={columnSortConfig("contract", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Site"
                    options={siteOptions}
                    applied={filters.site}
                    onApply={(next) => patchFilters({ site: next })}
                    sort={columnSortConfig("site", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Shift"
                    options={shiftOptions}
                    applied={filters.shift}
                    onApply={(next) => patchFilters({ shift: next })}
                    sort={columnSortConfig("shift", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <AttendanceSortableHeader
                    label="Clock-in"
                    columnId="clock_in"
                    valueType="text"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <AttendanceSortableHeader
                    label="Clock-out"
                    columnId="clock_out"
                    valueType="text"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <AttendanceSortableHeader
                    label="Hours"
                    columnId="hours_worked"
                    valueType="number"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <AttendanceSortableHeader
                    label="Exception"
                    columnId="exception"
                    valueType="text"
                    sort={sort}
                    onSortChange={setSort}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Status"
                    options={statusOptions}
                    applied={filters.status}
                    onApply={(next) => patchFilters({ status: next })}
                    sort={columnSortConfig("status", "text")}
                  />
                </th>
                <th className={scrollableTableThClassName}>
                  <RegisterColumnFilterHeader
                    label="Decision"
                    options={decisionOptions}
                    applied={filters.decision}
                    onApply={(next) => patchFilters({ decision: next })}
                    sort={columnSortConfig("decision", "text")}
                  />
                </th>
                <th className={`${scrollableTableThClassName} no-print`}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {displayEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={14}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    {loadingEntries
                      ? "Loading attendance entries…"
                      : hasActiveFilters
                        ? "No attendance entries match the current filters."
                        : "No attendance entries for this month."}
                  </td>
                </tr>
              ) : (
                displayEntries.map((entry, index) => (
                  <AttendanceRegisterRow
                    key={entry.id}
                    entry={entry}
                    index={index}
                    canDecide={canDecide}
                    deleting={deletingId === entry.id}
                    writeQueue={writeQueue}
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => void handleDelete(entry)}
                    onChangeDecision={() => {
                      setDecisionTarget(entry);
                      setDecisionNote("");
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </div>
    </div>
  );
}

function AttendanceSortableHeader({
  label,
  columnId,
  valueType,
  sort,
  onSortChange,
}: {
  label: string;
  columnId: string;
  valueType: RegisterColumnSortValueType;
  sort: RegisterColumnSortState | null;
  onSortChange: (next: RegisterColumnSortState) => void;
}) {
  const active = sort?.columnId === columnId;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium text-white"
      onClick={() =>
        onSortChange({
          columnId,
          valueType,
          direction:
            active && sort?.direction === "desc" ? "asc" : "desc",
        })
      }
    >
      {label}
      {active ? (
        <span className="text-[10px] leading-none text-white/90" aria-hidden>
          {sort?.direction === "asc" ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}

function AttendanceRegisterRow({
  entry,
  index,
  canDecide,
  deleting,
  writeQueue,
  onEdit,
  onDelete,
  onChangeDecision,
}: {
  entry: AttendanceRegisterDisplayRow;
  index: number;
  canDecide: boolean;
  deleting: boolean;
  writeQueue: ReturnType<typeof useWriteQueueOptional>;
  onEdit: () => void;
  onDelete: () => void;
  onChangeDecision: () => void;
}) {
  return (
    <tr className={getStripedRowClassName(index)}>
      <td className="px-4 py-3">{formatDate(entry.date)}</td>
      <td className="px-4 py-3">
        {entry.employeeName}
        {entry.isFormerStaff ? (
          <span className="ml-2 text-xs text-slate-500">Former</span>
        ) : null}
      </td>
      <td className="px-4 py-3">{entry.staff_id}</td>
      <td className="px-4 py-3">
        {entry.employmentTypeLabel === "(Blank)"
          ? "—"
          : entry.employmentTypeLabel}
      </td>
      <td className="px-4 py-3">
        {entry.contractLabel === "(Blank)" ? "—" : entry.contractLabel}
      </td>
      <td className="px-4 py-3">
        {entry.siteLabel === "(Blank)" ? "—" : entry.siteLabel}
      </td>
      <td className="px-4 py-3">
        {entry.shiftLabel === "(Blank)" ? "—" : entry.shiftLabel}
      </td>
      <td className="px-4 py-3">{formatTime(entry.clock_in)}</td>
      <td className="px-4 py-3">{formatTime(entry.clock_out)}</td>
      <td className="px-4 py-3">{entry.hours_worked ?? "—"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          {entry.exceptionLabel === "(Blank)" ? (
            <span>—</span>
          ) : (
            attendanceExceptionBadges(entry).map((badge) => (
              <span
                key={badge}
                className="inline-flex w-fit rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
              >
                {badge}
              </span>
            ))
          )}
          {canDecide &&
          !entry.pendingSync &&
          isReviewedException(entry.exception_status) ? (
            <button
              type="button"
              className="no-print w-fit text-left text-xs font-medium text-sky-800 underline"
              onClick={onChangeDecision}
            >
              Change decision
            </button>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span>{entry.statusLabel}</span>
          {entry.scheduled_day_type === "weekend" ? (
            <span className="inline-flex w-fit rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
              Weekend
            </span>
          ) : null}
          {entry.pendingSync ? (
            entry.queueError?.trim() ? (
              <Tooltip content={entry.queueError.trim()}>
                <span
                  className={`inline-flex w-fit rounded px-1.5 py-0.5 text-xs font-medium ${
                    entry.queueFailed
                      ? "bg-red-100 text-red-800"
                      : "bg-amber-100 text-amber-900"
                  }`}
                >
                  {entry.queueFailed ? "Sync failed" : "Pending sync"}
                </span>
              </Tooltip>
            ) : (
              <span
                className={`inline-flex w-fit rounded px-1.5 py-0.5 text-xs font-medium ${
                  entry.queueFailed
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-900"
                }`}
              >
                {entry.queueFailed ? "Sync failed" : "Pending sync"}
              </span>
            )
          ) : null}
          {entry.queueFailed && writeQueue ? (
            <button
              type="button"
              className="no-print text-left text-xs font-medium text-sky-800 underline"
              onClick={() => void writeQueue.retryItem(entry.id)}
            >
              Retry
            </button>
          ) : null}
        </div>
      </td>
      <td className="px-4 py-3">{entry.decisionLabel}</td>
      <RegisterRowActions
        onEdit={onEdit}
        onDelete={onDelete}
        deleting={deleting}
      />
    </tr>
  );
}
