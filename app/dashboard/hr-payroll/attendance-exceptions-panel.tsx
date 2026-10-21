"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { ATTENDANCE_CHANGED_EVENT, notifyAttendanceChanged } from "@/lib/attendance-changed";
import {
  decisionSavedToast,
  exceptionDecisionLabel,
  type AttendanceExceptionDecision,
} from "@/lib/attendance-exception-decision";
import {
  formatScheduleClock,
  isReviewedException,
  lateByLabel,
  leftEarlyLabel,
} from "@/lib/shift-attendance";
import { formatDate } from "@/app/dashboard/finance/income-register-utils";

type ExceptionView = "pending" | "decided" | "all";

type ExceptionRow = {
  id: string;
  date: string;
  staff_id: string;
  employee_name: string;
  scheduled_shift: string | null;
  scheduled_day_type?: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  clock_in: string | null;
  clock_out: string | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  exception_status?: string | null;
  attendance_status?: string | null;
  review_note?: string | null;
};

type SortKey = "date" | "employee" | "shift";

const DECISION_CHOICES: AttendanceExceptionDecision[] = [
  "full_day",
  "half_day",
  "absent",
];

const VIEW_OPTIONS: { id: ExceptionView; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "decided", label: "Decided" },
  { id: "all", label: "All" },
];

export default function AttendanceExceptionsPanel() {
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [canDecide, setCanDecide] = useState<boolean | null>(null);
  const alertErrorRef = useRef(alertError);
  alertErrorRef.current = alertError;
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [view, setView] = useState<ExceptionView>("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/attendance/exceptions?view=${view}`);
    const payload = (await response.json()) as {
      error?: string;
      canDecide?: boolean;
      rows?: ExceptionRow[];
    };
    if (!response.ok) {
      throw new Error(payload.error ?? "Could not load attendance exceptions.");
    }
    setCanDecide(payload.canDecide === true);
    setRows(payload.rows ?? []);
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        await load();
      } catch (error) {
        if (!cancelled) {
          await alertErrorRef.current(error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const onChanged = () => {
      void loadRef.current().catch((error: unknown) => {
        void alertErrorRef.current(error);
      });
    };
    window.addEventListener(ATTENDANCE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(ATTENDANCE_CHANGED_EVENT, onChanged);
  }, []);

  const visibleRows = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (!query) {
        return true;
      }
      const haystack = [
        row.date,
        row.employee_name,
        row.staff_id,
        row.scheduled_shift ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
    const sorted = [...filtered].sort((left, right) => {
      const leftValue =
        sortKey === "employee"
          ? left.employee_name || left.staff_id
          : sortKey === "shift"
            ? left.scheduled_shift ?? ""
            : left.date;
      const rightValue =
        sortKey === "employee"
          ? right.employee_name || right.staff_id
          : sortKey === "shift"
            ? right.scheduled_shift ?? ""
            : right.date;
      return leftValue.localeCompare(rightValue);
    });
    return sortAsc ? sorted : sorted.reverse();
  }, [filter, rows, sortAsc, sortKey]);

  function toggleSort(next: SortKey) {
    if (sortKey === next) {
      setSortAsc((current) => !current);
      return;
    }
    setSortKey(next);
    setSortAsc(next !== "date");
  }

  async function decide(row: ExceptionRow, decision: AttendanceExceptionDecision) {
    setSavingId(row.id);
    try {
      const response = await fetch("/api/attendance/exceptions/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          decision,
          note: notes[row.id] ?? "",
          attendanceStatus: row.attendance_status ?? null,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setSavingId(null);
        await alertError(new Error(payload.error ?? "Could not save the decision."));
        return;
      }
      toast(decisionSavedToast(decision));
      setChangingId(null);
      notifyAttendanceChanged();
    } catch (error) {
      setSavingId(null);
      await alertError(error);
    } finally {
      setSavingId(null);
    }
  }

  function sortLabel(key: SortKey, label: string) {
    const active = sortKey === key;
    const arrow = !active ? "" : sortAsc ? " ↑" : " ↓";
    return `${label}${arrow}`;
  }

  return (
    <section id="attendance-exceptions" className="mb-8 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Attendance exceptions
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Late arrivals and early leave beyond the grace period. Lateness
            stays on the record and does not deduct pay until you choose half
            day or absent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-300 p-0.5">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setView(option.id)}
                className={`rounded px-3 py-1 text-sm font-medium ${
                  view === option.id
                    ? "bg-[#0f2744] text-white"
                    : "text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by employee, date, or shift"
            aria-label="Filter attendance exceptions"
            className={`${inputClassName} max-w-xs`}
          />
        </div>
      </div>
      {canDecide === false ? (
        <p className="text-sm text-slate-600">
          You can view these exceptions. A director, HR user, or super admin
          records the decision.
        </p>
      ) : null}
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>
                <button type="button" onClick={() => toggleSort("date")}>
                  {sortLabel("date", "Date")}
                </button>
              </th>
              <th className={scrollableTableThClassName}>
                <button type="button" onClick={() => toggleSort("employee")}>
                  {sortLabel("employee", "Employee")}
                </button>
              </th>
              <th className={scrollableTableThClassName}>
                <button type="button" onClick={() => toggleSort("shift")}>
                  {sortLabel("shift", "Shift")}
                </button>
              </th>
              <th className={scrollableTableThClassName}>Scheduled</th>
              <th className={scrollableTableThClassName}>Actual</th>
              <th className={scrollableTableThClassName}>Exception</th>
              <th className={scrollableTableThClassName}>Note</th>
              <th className={scrollableTableThClassName}>Decision</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-sm text-slate-500">
                  Loading attendance exceptions…
                </td>
              </tr>
            ) : visibleRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-sm text-slate-500">
                  {view === "decided"
                    ? "No decided attendance exceptions."
                    : view === "all"
                      ? "No attendance exceptions."
                      : "No pending attendance exceptions."}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const late = lateByLabel(row.late_minutes);
                const early = leftEarlyLabel(row.early_leave_minutes);
                const busy = savingId === row.id;
                const decided = isReviewedException(row.exception_status);
                const showChoices = !decided || changingId === row.id;
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <div>{row.employee_name || "—"}</div>
                      <div className="text-xs text-slate-500">{row.staff_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span>{row.scheduled_shift ?? "—"}</span>
                      {row.scheduled_day_type === "weekend" ? (
                        <span className="ml-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">
                          Weekend
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {formatScheduleClock(row.scheduled_start)} –{" "}
                      {formatScheduleClock(row.scheduled_end)}
                    </td>
                    <td className="px-4 py-3">
                      {formatScheduleClock(row.clock_in)} –{" "}
                      {formatScheduleClock(row.clock_out)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1 text-sm">
                        {decided ? (
                          <span>{exceptionDecisionLabel(row.exception_status)}</span>
                        ) : null}
                        {late ? <span>{late}</span> : null}
                        {early ? <span>{early}</span> : null}
                        {!decided && !late && !early ? <span>Pending</span> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={notes[row.id] ?? ""}
                        disabled={!canDecide || busy}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [row.id]: event.target.value,
                          }))
                        }
                        aria-label={`Note for ${row.employee_name || row.staff_id}`}
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {showChoices ? (
                        <div className="flex flex-wrap gap-2">
                          {DECISION_CHOICES.map((decision) => (
                            <button
                              key={decision}
                              type="button"
                              disabled={!canDecide || busy}
                              onClick={() => void decide(row, decision)}
                              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-[#0f2744] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {exceptionDecisionLabel(decision)}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={!canDecide || busy}
                          onClick={() => setChangingId(row.id)}
                          className="text-xs font-medium text-sky-800 underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Change decision
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
