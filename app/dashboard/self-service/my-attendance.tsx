"use client";

import { useMemo, useState } from "react";
import type { AttendanceRegisterEntry } from "../hr-payroll/attendance-register-utils";
import {
  EXEMPT_ATTENDANCE_MESSAGE,
  isExemptMode,
  type AttendanceMode,
} from "@/lib/attendance-mode";
import {
  attendanceContractLabel,
  attendanceDayKind,
  attendanceExceptionLine,
  attendanceStatusLabel,
  buildMonthWeeks,
  daysInMonth,
  formatAttendanceClock,
  formatAttendanceDay,
  formatAttendanceHours,
  formatAttendanceHoursTotal,
  formatMonthTitle,
  isoDate,
  mondayIndex,
  monthPartsFromIso,
  selectionForMonth,
  shiftMonth,
  weekSummary,
  type AttendanceContractRef,
  type AttendanceDayKind,
  type MonthParts,
} from "./my-attendance-utils";

type MyAttendanceProps = {
  initialEntries: AttendanceRegisterEntry[];
  fetchError: string | null;
  employeeContract: string | null;
  projects: AttendanceContractRef[];
  /** Resolved mode. Exempt staff do not log attendance. */
  attendanceMode?: AttendanceMode;
};

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function accraToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Accra" });
}

function dayClassName(
  kind: AttendanceDayKind,
  selected: boolean,
  isToday: boolean,
): string {
  const tone =
    kind === "present"
      ? "bg-emerald-100 text-emerald-800"
      : kind === "late"
        ? "bg-amber-100 text-amber-900"
        : kind === "absent"
          ? "bg-red-100 text-red-800"
          : kind === "leave"
            ? "bg-blue-100 text-blue-800"
            : kind === "half_day"
              ? "bg-[linear-gradient(135deg,#fef3c7_50%,#e2e8f0_50%)] text-amber-950"
              : "bg-slate-50 text-slate-400";
  const ring = selected ? "ring-2 ring-[#0f2744] ring-offset-1" : "";
  const todayMark = isToday ? "outline outline-1 outline-slate-500" : "";
  return `flex min-h-10 flex-col items-center justify-center rounded-md text-sm font-medium sm:min-h-12 ${tone} ${ring} ${todayMark}`;
}

function chipClassName(kind: AttendanceDayKind | "hours"): string {
  switch (kind) {
    case "present":
      return "bg-emerald-100 text-emerald-800";
    case "late":
      return "bg-amber-100 text-amber-900";
    case "absent":
      return "bg-red-100 text-red-800";
    case "leave":
      return "bg-blue-100 text-blue-800";
    case "half_day":
      return "bg-amber-50 text-amber-900 ring-1 ring-amber-300";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function statusTextClassName(kind: AttendanceDayKind): string {
  switch (kind) {
    case "present":
      return "text-emerald-700";
    case "late":
      return "text-amber-800";
    case "absent":
      return "text-red-700";
    case "leave":
      return "text-blue-700";
    case "half_day":
      return "text-amber-800";
    default:
      return "text-slate-400";
  }
}

export default function MyAttendance({
  initialEntries,
  fetchError,
  employeeContract,
  projects,
  attendanceMode = "standard",
}: MyAttendanceProps) {
  const today = accraToday();
  const [month, setMonth] = useState<MonthParts>(() => monthPartsFromIso(today));
  const [selected, setSelected] = useState(today);
  const [openWeek, setOpenWeek] = useState<number | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, AttendanceRegisterEntry>();
    for (const entry of initialEntries) {
      const key = entry.date.slice(0, 10);
      if (!map.has(key)) {
        map.set(key, entry);
      }
    }
    return map;
  }, [initialEntries]);

  const monthPrefix = `${month.year}-${String(month.month).padStart(2, "0")}`;
  const monthEntries = initialEntries.filter((entry) =>
    entry.date.slice(0, 10).startsWith(monthPrefix),
  );
  const counts = {
    present: 0,
    late: 0,
    absent: 0,
    half_day: 0,
    leave: 0,
  };
  for (const entry of monthEntries) {
    const kind = attendanceDayKind(entry);
    if (kind !== "empty") {
      counts[kind] += 1;
    }
  }
  const hoursTotal = formatAttendanceHoursTotal(
    monthEntries.map((entry) => Number(entry.hours_worked) || 0),
  );
  const weeks = buildMonthWeeks(month);
  const selectedWeek =
    weeks.find((week) => week.dates.includes(selected))?.week ?? null;
  const expandedWeek = openWeek ?? selectedWeek;
  const selectedEntry = byDate.get(selected) ?? null;
  const selectedKind = attendanceDayKind(selectedEntry);
  const selectedInMonth = selected.startsWith(monthPrefix);
  const leadingBlanks = mondayIndex(month.year, month.month, 1);
  const dayCount = daysInMonth(month.year, month.month);

  function recordedDates(): string[] {
    return [...byDate.keys()];
  }

  function showMonth(next: MonthParts) {
    setMonth(next);
    setSelected(selectionForMonth(next, today, recordedDates()));
    setOpenWeek(null);
  }

  function openDate(iso: string) {
    setSelected(iso);
    setMonth(monthPartsFromIso(iso));
    setOpenWeek(null);
  }

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load attendance: {fetchError}
      </div>
    );
  }

  if (isExemptMode(attendanceMode)) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold text-[#0f2744]">My attendance</h2>
        <p className="mt-3 text-sm text-slate-600">
          {EXEMPT_ATTENDANCE_MESSAGE}
        </p>
      </section>
    );
  }

  const contractLabel = attendanceContractLabel({
    projectAssignment: selectedEntry?.project_assignment,
    employeeContract,
    projects,
  });
  const exceptionLine = selectedEntry ? attendanceExceptionLine(selectedEntry) : null;
  const inTime = formatAttendanceClock(selectedEntry?.clock_in);
  const outTime = formatAttendanceClock(selectedEntry?.clock_out);
  const hoursLabel = formatAttendanceHours(selectedEntry?.hours_worked);
  const detailBits = [
    `In ${selectedEntry ? inTime : "—"}`,
    `Out ${selectedEntry ? outTime : "—"}`,
    hoursLabel,
    contractLabel !== "—" ? contractLabel : null,
    selectedEntry?.scheduled_shift?.trim() || null,
  ].filter(Boolean);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-[#0f2744]">My attendance</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => showMonth(shiftMonth(month, -1))}
            >
              ‹
            </button>
            <span className="min-w-28 text-center text-sm font-medium text-[#0f2744]">
              {formatMonthTitle(month)}
            </span>
            <button
              type="button"
              aria-label="Next month"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => showMonth(shiftMonth(month, 1))}
            >
              ›
            </button>
          </div>
          <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-700">
            <span>Find a date</span>
            <input
              type="date"
              aria-label="Find a date"
              className="bg-transparent text-sm"
              value={selected}
              onChange={(event) => {
                if (event.target.value) {
                  openDate(event.target.value);
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ["present", `Present ${counts.present}`],
            ["late", `Late ${counts.late}`],
            ["absent", `Absent ${counts.absent}`],
            ["half_day", `Half day ${counts.half_day}`],
            ["leave", `Leave or holiday ${counts.leave}`],
          ] as const
        ).map(([kind, label]) => (
          <span
            key={kind}
            className={`rounded-full px-3 py-1 text-sm font-medium ${chipClassName(kind)}`}
          >
            {label}
          </span>
        ))}
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${chipClassName("hours")}`}>
          Hours {hoursTotal}
        </span>
      </div>

      <div className="mt-4">
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-500 sm:gap-2">
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} className="py-1">
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: leadingBlanks }, (_, index) => (
            <div key={`blank-${index}`} />
          ))}
          {Array.from({ length: dayCount }, (_, index) => {
            const day = index + 1;
            const date = isoDate(month.year, month.month, day);
            const entry = byDate.get(date) ?? null;
            const kind = attendanceDayKind(entry);
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                aria-label={
                  isToday
                    ? `${formatAttendanceDay(date, true)}, today`
                    : formatAttendanceDay(date, true)
                }
                aria-current={isToday ? "date" : undefined}
                aria-pressed={selected === date}
                className={dayClassName(kind, selected === date, isToday)}
                onClick={() => openDate(date)}
              >
                <span>{day}</span>
                {isToday ? (
                  <span className="text-[9px] font-medium leading-none">Today</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {selectedInMonth ? (
        <div className="mt-4 rounded-lg border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-[#0f2744]">
              {formatAttendanceDay(selected, true)}
            </p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${chipClassName(selectedKind)}`}
            >
              {attendanceStatusLabel(selectedKind, selectedEntry?.attendance_status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {detailBits.length > 0 ? detailBits.join(" · ") : "No attendance recorded."}
          </p>
          {exceptionLine ? (
            <p className="mt-1 text-sm text-slate-700">{exceptionLine}</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 divide-y divide-slate-200 border-t border-slate-200">
        {weeks.map((week) => {
          const open = expandedWeek === week.week;
          const summary = weekSummary(
            week.dates.map((date) => attendanceDayKind(byDate.get(date) ?? null)),
          );
          return (
            <div key={week.week}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-3 text-left"
                aria-expanded={open}
                aria-label={`${week.label}, ${open ? "collapse week" : "expand week"}`}
                onClick={() => setOpenWeek(open ? -1 : week.week)}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-[#0f2744]">
                  <span aria-hidden className="w-4 text-center text-slate-600">
                    {open ? "▾" : "▸"}
                  </span>
                  {week.label}
                </span>
                <span className="text-right text-sm text-slate-500">{summary}</span>
              </button>
              {open ? (
                <ul className="pb-2">
                  {week.dates.map((date) => {
                    const entry = byDate.get(date) ?? null;
                    const kind = attendanceDayKind(entry);
                    const clocks =
                      entry?.clock_in || entry?.clock_out
                        ? `${formatAttendanceClock(entry?.clock_in)} – ${formatAttendanceClock(entry?.clock_out)}`
                        : null;
                    const rowHours = formatAttendanceHours(entry?.hours_worked);
                    const right =
                      kind === "absent" || kind === "leave" || kind === "half_day"
                        ? attendanceStatusLabel(kind, entry?.attendance_status)
                        : clocks
                          ? [clocks, rowHours].filter(Boolean).join(" · ")
                          : kind === "empty"
                            ? ""
                            : attendanceStatusLabel(kind, entry?.attendance_status);
                    return (
                      <li key={date}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm"
                          onClick={() => openDate(date)}
                        >
                          <span className="text-slate-800">
                            {formatAttendanceDay(date, false)}
                          </span>
                          <span className={statusTextClassName(kind)}>{right}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
