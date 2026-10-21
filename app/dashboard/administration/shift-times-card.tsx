"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import TimePickerField from "@/components/time-picker-field";
import { inputClassName } from "../employees/employee-record-utils";
import PublicHolidaysCard, { type TenantHoliday } from "./public-holidays-card";
import {
  SCHEDULE_DAY_TYPES,
  SCHEDULE_SHIFTS,
  describeShiftLength,
  shiftTimeDayType,
  timeInputValue,
  type ScheduleDayType,
  type ScheduleShift,
  type ShiftTimeRecord,
} from "@/lib/shift-attendance";

type Draft = {
  start: string;
  end: string;
  late: string;
  early: string;
};

type ShiftTimesCardProps = {
  tenantId: string | null;
  clientId: string;
  initialGrace: { late_grace_minutes: number; early_leave_grace_minutes: number } | null;
  initialShiftTimes: ShiftTimeRecord[];
  loadError: string | null;
  previousTimes: {
    morning: string;
    afternoon: string;
    supervisor: string;
  };
  initialHolidays: TenantHoliday[];
  holidayLoadError: string | null;
};

function emptyDrafts(): Record<ScheduleShift, Draft> {
  return Object.fromEntries(
    SCHEDULE_SHIFTS.map((shift) => [
      shift,
      { start: "", end: "", late: "", early: "" },
    ]),
  ) as Record<ScheduleShift, Draft>;
}

function draftsFromRows(
  clientId: string,
  rows: ShiftTimeRecord[],
  dayType: ScheduleDayType,
): Record<ScheduleShift, Draft> {
  const drafts = emptyDrafts();
  for (const row of rows) {
    if (
      row.client_id !== clientId ||
      shiftTimeDayType(row.day_type) !== dayType ||
      !SCHEDULE_SHIFTS.includes(row.shift as ScheduleShift)
    ) {
      continue;
    }
    const shift = row.shift as ScheduleShift;
    drafts[shift] = {
      start: timeInputValue(row.start_time),
      end: timeInputValue(row.end_time),
      late: row.late_grace_minutes == null ? "" : String(row.late_grace_minutes),
      early:
        row.early_leave_grace_minutes == null
          ? ""
          : String(row.early_leave_grace_minutes),
    };
  }
  return drafts;
}

function draftsByDayFromRows(
  clientId: string,
  rows: ShiftTimeRecord[],
): Record<ScheduleDayType, Record<ScheduleShift, Draft>> {
  return {
    weekday: draftsFromRows(clientId, rows, "weekday"),
    weekend: draftsFromRows(clientId, rows, "weekend"),
  };
}

function optionalMinutes(input: HTMLInputElement): number | null | false {
  input.setCustomValidity("");
  const trimmed = input.value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    input.setCustomValidity("Enter a whole number of minutes, or leave this blank.");
    input.reportValidity();
    return false;
  }
  return Number(trimmed);
}

export default function ShiftTimesCard({
  tenantId,
  clientId,
  initialGrace,
  initialShiftTimes,
  loadError,
  previousTimes,
  initialHolidays,
  holidayLoadError,
}: ShiftTimesCardProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const alertErrorRef = useRef(alertError);
  alertErrorRef.current = alertError;
  const [rows, setRows] = useState(initialShiftTimes);
  const [dayType, setDayType] = useState<ScheduleDayType>("weekday");
  const [draftsByDay, setDraftsByDay] = useState(() =>
    draftsByDayFromRows(clientId, initialShiftTimes),
  );
  const [lateGrace, setLateGrace] = useState(
    String(initialGrace?.late_grace_minutes ?? 30),
  );
  const [earlyGrace, setEarlyGrace] = useState(
    String(initialGrace?.early_leave_grace_minutes ?? 30),
  );
  const [savingShifts, setSavingShifts] = useState(false);
  const [savingGrace, setSavingGrace] = useState(false);

  useEffect(() => {
    if (loadError) {
      void alertErrorRef.current(loadError);
    }
  }, [loadError]);

  useEffect(() => {
    setRows(initialShiftTimes);
  }, [initialShiftTimes]);

  useEffect(() => {
    setDraftsByDay(draftsByDayFromRows(clientId, rows));
  }, [clientId, rows]);

  const drafts = draftsByDay[dayType];

  function updateDraft(shift: ScheduleShift, patch: Partial<Draft>) {
    setDraftsByDay((current) => ({
      ...current,
      [dayType]: {
        ...current[dayType],
        [shift]: { ...current[dayType][shift], ...patch },
      },
    }));
  }

  function copyWeekdayTimes() {
    setDraftsByDay((current) => ({
      ...current,
      weekend: {
        "Full Day": { ...current.weekday["Full Day"] },
        Morning: { ...current.weekday.Morning },
        Afternoon: { ...current.weekday.Afternoon },
        Night: { ...current.weekday.Night },
        Supervisor: { ...current.weekday.Supervisor },
      },
    }));
  }

  async function saveShiftTimes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const contract = document.getElementById("roster-contract");
    if (contract instanceof HTMLSelectElement) {
      contract.setCustomValidity("");
    }
    if (!clientId) {
      if (contract instanceof HTMLSelectElement) {
        contract.setCustomValidity("Select a contract before saving shift times.");
        contract.reportValidity();
      }
      return;
    }
    if (!tenantId) {
      await alertError(new Error("Could not resolve the workspace."));
      return;
    }

    const parsed: Array<{
      shift: ScheduleShift;
      start: string;
      end: string;
      late: number | null;
      early: number | null;
    }> = [];

    for (const shift of SCHEDULE_SHIFTS) {
      const draft = drafts[shift];
      const startField = form.elements.namedItem(`start-${dayType}-${shift}`);
      const endField = form.elements.namedItem(`end-${dayType}-${shift}`);
      const lateInput = form.elements.namedItem(`late-${dayType}-${shift}`);
      const earlyInput = form.elements.namedItem(`early-${dayType}-${shift}`);
      if (
        !(startField instanceof HTMLInputElement) ||
        !(endField instanceof HTMLInputElement) ||
        !(lateInput instanceof HTMLInputElement) ||
        !(earlyInput instanceof HTMLInputElement)
      ) {
        continue;
      }
      startField.setCustomValidity("");
      endField.setCustomValidity("");
      const start = draft.start;
      const end = draft.end;
      if (Boolean(start) !== Boolean(end)) {
        const target = start ? endField : startField;
        target.setCustomValidity(
          "Enter both a start time and an end time, or leave both blank.",
        );
        target.reportValidity();
        return;
      }
      const late = optionalMinutes(lateInput);
      if (late === false) {
        return;
      }
      const early = optionalMinutes(earlyInput);
      if (early === false) {
        return;
      }
      parsed.push({ shift, start, end, late, early });
    }

    const warnings = parsed.flatMap((row) => {
      const info = describeShiftLength(row.shift, row.start, row.end);
      return info?.warn ? [info.warningSentence] : [];
    });
    if (warnings.length > 0) {
      const proceed = await confirm({
        title: "Check these shift times",
        message: warnings.join("\n\n"),
        confirmLabel: "Save anyway",
        cancelLabel: "Go back and fix",
      });
      if (!proceed) {
        return;
      }
    }

    setSavingShifts(true);
    try {
      for (const row of parsed) {
        if (!row.start || !row.end) {
          const { error } = await supabase
            .from("contract_shift_times")
            .delete()
            .eq("tenant_id", tenantId)
            .eq("client_id", clientId)
            .eq("shift", row.shift)
            .eq("day_type", dayType);
          if (error) {
            throw new Error(error.message);
          }
          continue;
        }
        const { error } = await supabase.from("contract_shift_times").upsert(
          {
            tenant_id: tenantId,
            client_id: clientId,
            shift: row.shift,
            day_type: dayType,
            start_time: `${row.start}:00`,
            end_time: `${row.end}:00`,
            late_grace_minutes: row.late,
            early_leave_grace_minutes: row.early,
          },
          { onConflict: "tenant_id,client_id,shift,day_type" },
        );
        if (error) {
          throw new Error(error.message);
        }
      }
      setRows((current) => {
        const others = current.filter(
          (row) =>
            row.client_id !== clientId || shiftTimeDayType(row.day_type) !== dayType,
        );
        const next = parsed
          .filter((row) => row.start && row.end)
          .map((row) => ({
            client_id: clientId,
            shift: row.shift,
            day_type: dayType,
            start_time: `${row.start}:00`,
            end_time: `${row.end}:00`,
            late_grace_minutes: row.late,
            early_leave_grace_minutes: row.early,
          }));
        return [...others, ...next];
      });
      toast("Shift times saved.");
    } catch (error) {
      await alertError(error);
    } finally {
      setSavingShifts(false);
    }
  }

  async function saveGrace(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenantId) {
      await alertError(new Error("Could not resolve the workspace."));
      return;
    }
    const form = event.currentTarget;
    const lateInput = form.elements.namedItem("late-grace");
    const earlyInput = form.elements.namedItem("early-grace");
    if (
      !(lateInput instanceof HTMLInputElement) ||
      !(earlyInput instanceof HTMLInputElement)
    ) {
      return;
    }
    const late = optionalMinutes(lateInput);
    const early = optionalMinutes(earlyInput);
    if (late === false || early === false || late == null || early == null) {
      if (late == null) {
        lateInput.setCustomValidity("Enter the late grace in whole minutes.");
        lateInput.reportValidity();
      } else if (early == null) {
        earlyInput.setCustomValidity("Enter the early-leave grace in whole minutes.");
        earlyInput.reportValidity();
      }
      return;
    }

    setSavingGrace(true);
    try {
      const { error } = await supabase.from("attendance_grace_policy").upsert(
        {
          tenant_id: tenantId,
          late_grace_minutes: late,
          early_leave_grace_minutes: early,
        },
        { onConflict: "tenant_id" },
      );
      if (error) {
        throw new Error(error.message);
      }
      toast("Attendance grace saved.");
    } catch (error) {
      await alertError(error);
    } finally {
      setSavingGrace(false);
    }
  }

  return (
    <>
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">Shift times</h3>
          <p className="mt-1 text-sm text-slate-600">
            Start and end for this contract. An end time before the start
            crosses midnight. Leave a grace box blank to use the company
            default.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Shift day type">
          {SCHEDULE_DAY_TYPES.map((option) => {
            const active = dayType === option;
            const label =
              option === "weekday"
                ? "Weekdays (Mon–Fri)"
                : "Weekend & holidays (Sat, Sun, public holidays)";
            return (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDayType(option)}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? "bg-[#0f2744] text-white"
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {dayType === "weekend" ? (
          <p className="text-sm text-slate-600">
            Leave blank if this contract does not work weekends or holidays —
            attendance is still recorded but not flagged.
          </p>
        ) : null}
        <form onSubmit={(event) => void saveShiftTimes(event)} className="space-y-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="px-2 py-2 font-medium">Shift</th>
                  <th className="px-2 py-2 font-medium">Start</th>
                  <th className="px-2 py-2 font-medium">End</th>
                  <th className="px-2 py-2 font-medium">Length</th>
                  <th className="px-2 py-2 font-medium">Late grace (min)</th>
                  <th className="px-2 py-2 font-medium">Early-leave grace (min)</th>
                </tr>
              </thead>
              <tbody>
                {SCHEDULE_SHIFTS.map((shift) => {
                  const length = describeShiftLength(
                    shift,
                    drafts[shift].start,
                    drafts[shift].end,
                  );
                  return (
                  <tr key={shift}>
                    <td className="px-2 py-2 font-medium text-[#0f2744]">{shift}</td>
                    <td className="px-2 py-2">
                      <TimePickerField
                        name={`start-${dayType}-${shift}`}
                        aria-label={`${shift} start`}
                        value={drafts[shift].start}
                        disabled={savingShifts}
                        onChange={(start) => updateDraft(shift, { start })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <TimePickerField
                        name={`end-${dayType}-${shift}`}
                        aria-label={`${shift} end`}
                        value={drafts[shift].end}
                        disabled={savingShifts}
                        onChange={(end) => updateDraft(shift, { end })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {length?.warn ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950">
                          {length.lengthLabel}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-700">
                          {length?.lengthLabel ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        name={`late-${dayType}-${shift}`}
                        value={drafts[shift].late}
                        onChange={(event) => {
                          event.currentTarget.setCustomValidity("");
                          updateDraft(shift, { late: event.target.value });
                        }}
                        aria-label={`${shift} late grace minutes`}
                        className={inputClassName}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        name={`early-${dayType}-${shift}`}
                        value={drafts[shift].early}
                        onChange={(event) => {
                          event.currentTarget.setCustomValidity("");
                          updateDraft(shift, { early: event.target.value });
                        }}
                        aria-label={`${shift} early-leave grace minutes`}
                        className={inputClassName}
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2">
            {dayType === "weekend" ? (
              <button
                type="button"
                onClick={copyWeekdayTimes}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Copy weekday times
              </button>
            ) : null}
            <button
              type="submit"
              disabled={savingShifts}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {savingShifts ? "Saving…" : "Save shift times"}
            </button>
          </div>
        </form>
        <div>
          <h4 className="text-sm font-semibold text-[#0f2744]">Previous text times</h4>
          <p className="mt-1 text-sm text-slate-600">
            Copy these into the shift times above. They stay on the roster and
            are no longer edited here.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="block text-sm text-slate-700">
              Morning
              <input
                readOnly
                value={previousTimes.morning}
                className={`${inputClassName} mt-1`}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Afternoon
              <input
                readOnly
                value={previousTimes.afternoon}
                className={`${inputClassName} mt-1`}
              />
            </label>
            <label className="block text-sm text-slate-700">
              Supervisor
              <input
                readOnly
                value={previousTimes.supervisor}
                className={`${inputClassName} mt-1`}
              />
            </label>
          </div>
        </div>
      </section>

      <PublicHolidaysCard
        tenantId={tenantId}
        initialHolidays={initialHolidays}
        loadError={holidayLoadError}
      />

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">Attendance grace</h3>
          <p className="mt-1 text-sm text-slate-600">
            Company-wide minutes. A shift row can override either value.
          </p>
        </div>
        <form onSubmit={(event) => void saveGrace(event)} className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Late grace minutes
            <input
              type="number"
              min={0}
              step={1}
              required
              name="late-grace"
              value={lateGrace}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setLateGrace(event.target.value);
              }}
              className={`${inputClassName} mt-1`}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Early-leave grace minutes
            <input
              type="number"
              min={0}
              step={1}
              required
              name="early-grace"
              value={earlyGrace}
              onChange={(event) => {
                event.currentTarget.setCustomValidity("");
                setEarlyGrace(event.target.value);
              }}
              className={`${inputClassName} mt-1`}
            />
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={savingGrace}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {savingGrace ? "Saving…" : "Save attendance grace"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
