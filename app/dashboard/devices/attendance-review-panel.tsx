"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import DashboardButton from "@/components/dashboard-button";
import TimePickerField from "@/components/time-picker-field";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";
import { hoursBetweenClockTimes } from "@/lib/attendance-requests/rules";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import CollapsibleDeviceSection from "./collapsible-device-section";

type PunchItem = {
  id: string;
  staff_id: string | null;
  employee_name: string | null;
  device_pin: string;
  punch_time: string;
  process_note: string | null;
  review_text: string | null;
  review_code: string | null;
  attendance_register_id: string | null;
  register_clock_in: string | null;
};

type OpenRow = {
  id: string;
  staff_id: string;
  employee_name: string | null;
  date: string;
  clock_in: string | null;
  site_code: string | null;
};

type EmployeeOption = { staff_id: string; full_name: string };

export default function AttendanceReviewPanel({
  tenantId,
  canWriteDevices,
  canSetClockOut,
  canReprocessPunches,
  refreshToken = 0,
  onSilentResult,
}: {
  tenantId: string | null;
  canWriteDevices: boolean;
  canSetClockOut: boolean;
  canReprocessPunches: boolean;
  refreshToken?: number;
  onSilentResult?: (ok: boolean) => void;
}) {
  const { toast } = useToast();
  const { alertError } = useAlert();
  const [punches, setPunches] = useState<PunchItem[]>([]);
  const [openRows, setOpenRows] = useState<OpenRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clockOutById, setClockOutById] = useState<Record<string, string>>({});
  const [pinStaff, setPinStaff] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const onSilentResultRef = useRef(onSilentResult);
  onSilentResultRef.current = onSilentResult;

  const load = useCallback(async (silent = false) => {
    const response = await fetch("/api/attendance/review");
    const body = (await response.json().catch(() => null)) as {
      punches?: PunchItem[];
      openRows?: OpenRow[];
      employees?: EmployeeOption[];
      error?: string;
    } | null;
    if (!response.ok) {
      if (silent) {
        onSilentResultRef.current?.(false);
        return;
      }
      void alertError(body?.error ?? "Could not load items that need review.", {
        title: "Could not load review",
      });
      return;
    }
    setPunches(body?.punches ?? []);
    setOpenRows(body?.openRows ?? []);
    setEmployees(body?.employees ?? []);
    setError(null);
    if (silent) {
      onSilentResultRef.current?.(true);
    }
  }, [alertError]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    if (refreshToken === 0) {
      return;
    }
    void load(true);
  }, [load, refreshToken]);

  async function saveClockOut(registerId: string, clockIn: string | null) {
    if (!canSetClockOut) {
      void alertError("Only HR, a director, or a super admin can set a clock-out.", {
        title: "Could not save clock-out",
      });
      return;
    }
    if (!tenantId) {
      void alertError("Workspace session unavailable.", {
        title: "Could not save clock-out",
      });
      return;
    }
    const clockOut = clockOutById[registerId];
    if (!clockIn || !clockOut) {
      void alertError("Clock-in and clock-out are both needed.", {
        title: "Could not save clock-out",
      });
      return;
    }
    const hours = hoursBetweenClockTimes(clockIn, clockOut);
    if (hours == null) {
      void alertError("Clock-out must be after clock-in on the same day.", {
        title: "Could not save clock-out",
      });
      return;
    }
    const normalized = clockOut.length === 5 ? `${clockOut}:00` : clockOut;
    setBusyId(registerId);
    setError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("attendance_register")
      .update({ clock_out: normalized, hours_worked: hours })
      .eq("tenant_id", tenantId)
      .eq("id", registerId);
    setBusyId(null);
    if (updateError) {
      void alertError(updateError.message, { title: "Could not save clock-out" });
      return;
    }
    toast("Clock-out saved");
    await load();
  }

  async function dismiss(punchId: string) {
    setBusyId(punchId);
    setError(null);
    const response = await fetch("/api/attendance/review/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ punch_id: punchId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyId(null);
    if (!response.ok) {
      void alertError(body?.error ?? "Could not dismiss the note.", {
        title: "Could not dismiss",
      });
      return;
    }
    toast("Review note dismissed");
    await load();
  }

  async function mapPin(devicePin: string) {
    const staffId = pinStaff[devicePin];
    if (!canWriteDevices) {
      void alertError("You do not have permission to assign attendance PINs.", {
        title: "Could not map PIN",
      });
      return;
    }
    if (!staffId) {
      void alertError("Choose an employee for this PIN.", {
        title: "Could not map PIN",
      });
      return;
    }
    setBusyId(devicePin);
    setError(null);
    const response = await fetch("/api/attendance/review/map-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_pin: devicePin, staff_id: staffId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setBusyId(null);
    if (!response.ok) {
      void alertError(body?.error ?? "Could not map the PIN.", {
        title: "Could not map PIN",
      });
      return;
    }
    toast("PIN saved");
    await load();
  }

  async function reprocessPunches() {
    if (!canReprocessPunches) {
      void alertError(
        "Only HR, a director, or a super admin can reprocess attendance punches.",
        { title: "Could not reprocess punches" },
      );
      return;
    }
    const response = await fetch("/api/attendance/review/reprocess", {
      method: "POST",
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      void alertError(body?.error ?? "Could not reprocess punches.", {
        title: "Could not reprocess punches",
      });
      return;
    }
    toast("Punches reprocessed");
    await load();
  }

  const reviewCount = punches.length;

  return (
    <>
      <CollapsibleDeviceSection
        storageKey="needs-review"
        title="Needs review"
        summary={reviewCount === 0 ? "Nothing needs review" : `${reviewCount} items`}
        defaultOpen={reviewCount > 0}
      >
      <p className="mb-4 text-sm text-slate-600">
        Missing clock-outs after the 16-hour session window, future punches,
        punches blocked by an existing attendance row, unmapped PINs, and
        punches that were stored and not processed. An open session still
        inside its window is listed under Open device attendance. Late and
        early-leave decisions are on{" "}
        <a
          href="/dashboard/hr-payroll/attendance#attendance-exceptions"
          className="font-medium text-[#0f2744] underline"
        >
          Attendance exceptions
        </a>
        .
      </p>
      {canReprocessPunches ? (
        <div className="mb-4">
          <DashboardButton type="button" variant="secondary" onClick={() => void reprocessPunches()}>
            Reprocess
          </DashboardButton>
        </div>
      ) : null}
      {error ? (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>When</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Note</th>
              <th className={scrollableTableThClassName}>Action</th>
            </tr>
          </thead>
          <tbody>
            {punches.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  Nothing needs review
                </td>
              </tr>
            ) : (
              punches.map((punch) => (
                <tr key={punch.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3">
                    {new Date(punch.punch_time).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {punch.employee_name ?? punch.staff_id ?? `PIN ${punch.device_pin}`}
                  </td>
                  <td
                    className="px-4 py-3"
                    title={punch.review_code || punch.process_note || undefined}
                  >
                    {punch.review_text ?? punch.process_note ?? "PIN not linked to any employee"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {canSetClockOut &&
                      punch.process_note === "missing_clock_out" &&
                      punch.attendance_register_id ? (
                        <>
                          <TimePickerField
                            aria-label="Clock out"
                            value={clockOutById[punch.attendance_register_id] ?? ""}
                            onChange={(value) =>
                              setClockOutById((current) => ({
                                ...current,
                                [punch.attendance_register_id!]: value,
                              }))
                            }
                          />
                          <DashboardButton
                            type="button"
                            disabled={busyId === punch.attendance_register_id}
                            onClick={() =>
                              void saveClockOut(
                                punch.attendance_register_id!,
                                punch.register_clock_in,
                              )
                            }
                          >
                            Save clock-out
                          </DashboardButton>
                        </>
                      ) : null}
                      {canWriteDevices && !punch.staff_id ? (
                        <>
                          <select
                            className={inputClassName}
                            value={pinStaff[punch.device_pin] ?? ""}
                            onChange={(event) =>
                              setPinStaff((current) => ({
                                ...current,
                                [punch.device_pin]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Map PIN {punch.device_pin}</option>
                            {employees.map((employee) => (
                              <option key={employee.staff_id} value={employee.staff_id}>
                                {employee.staff_id} — {employee.full_name}
                              </option>
                            ))}
                          </select>
                          <DashboardButton
                            type="button"
                            disabled={busyId === punch.device_pin}
                            onClick={() => void mapPin(punch.device_pin)}
                          >
                            Map PIN
                          </DashboardButton>
                        </>
                      ) : null}
                      {canWriteDevices ? (
                      <button
                        type="button"
                        className="text-sm text-slate-700 underline"
                        disabled={busyId === punch.id}
                        onClick={() => void dismiss(punch.id)}
                      >
                        Dismiss
                      </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
      </CollapsibleDeviceSection>

      <CollapsibleDeviceSection
        storageKey="open-device-attendance"
        title="Open device attendance"
        summary={
          openRows.length === 0
            ? "None open"
            : `${openRows.length} still open`
        }
        defaultOpen={openRows.length > 0}
      >
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Clock in</th>
              <th className={scrollableTableThClassName}>Clock out</th>
            </tr>
          </thead>
          <tbody>
            {openRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                  No open device attendance
                </td>
              </tr>
            ) : (
              openRows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">{row.date}</td>
                  <td className="px-4 py-3">
                    {row.employee_name ?? row.staff_id}
                    {row.site_code ? ` · ${row.site_code}` : ""}
                  </td>
                  <td className="px-4 py-3">{row.clock_in ?? "—"}</td>
                  <td className="px-4 py-3">
                    {canSetClockOut ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <TimePickerField
                        aria-label="Clock out"
                        value={clockOutById[row.id] ?? ""}
                        onChange={(value) =>
                          setClockOutById((current) => ({
                            ...current,
                            [row.id]: value,
                          }))
                        }
                      />
                      <DashboardButton
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void saveClockOut(row.id, row.clock_in)}
                      >
                        Save clock-out
                      </DashboardButton>
                    </div>
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
      </CollapsibleDeviceSection>
    </>
  );
}
