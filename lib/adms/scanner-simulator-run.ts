import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  employeeMatchesStaffGroup,
  staffGroupKeyForProject,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";
import type { AttendanceDeviceRow } from "@/lib/adms/device-registry";
import {
  addDays,
  expectationForCountedScenario,
  formatAttlogBody,
  freshenFixedPunches,
  simulatorPunchesToSend,
  singlePunchSendPlan,
  singlePunchCardVerdict,
  simulatorAttendanceSnapshot,
  staffGroupDayExpectation,
  offlineBatchExpectation,
  pairedDayExpectation,
  gradeScenario,
  isSimulatorUnknownPin,
  mondayOf,
  nonAttlogBody,
  nonAttlogLineCount,
  planClockDrift,
  planOfflineBatch,
  planStaffGroupDay,
  planUnknownPin,
  planWrongTimezone,
  punchSentToNeedsReview,
  SIMULATOR_HEARTBEAT_CALLS,
  SIMULATOR_WORK_CODE,
  simulatorPunchIsCleanupTarget,
  simulatorScenarioTitle,
  unusedSimulatorPin,
  weekIsPast,
  type PlannedPunch,
  type SimulatorResultCard,
  type SimulatorScenarioId,
} from "@/lib/adms/scanner-simulator-traffic";
import {
  loadShiftScheduleContext,
  rosterAssignmentsForEmployee,
} from "@/lib/shift-attendance-context";
import {
  resolveExpectedSchedule,
  type RosterCoverage,
} from "@/lib/shift-attendance";
import {
  deviceTimezoneOrDefault,
  formatTimeInZone,
  localDateInZone,
} from "@/lib/adms/timezone-utils";

const DEFAULT_START = "08:00:00";
const DEFAULT_END = "17:00:00";

type SimEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  shift: string | null;
  position: string | null;
  contract_project: string | null;
  pin: string;
};

type PunchRow = {
  id: string;
  raw_line: string | null;
  staff_id: string | null;
  process_note: string | null;
  attendance_register_id: string | null;
  device_pin: string | null;
  punch_local_date: string | null;
};

type AttendanceRow = {
  id: string;
  staff_id: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | string | null;
  attendance_status: string | null;
  exception_status: string | null;
};

export type SimulatorEmployeeOption = {
  staffId: string;
  fullName: string;
  pin: string;
};

function failedCard(
  scenario: SimulatorScenarioId,
  reason: string,
): SimulatorResultCard {
  return {
    scenario,
    title: simulatorScenarioTitle(scenario),
    pass: false,
    resultKind: scenario === "single_punch" ? "error" : "graded",
    linesSent: 0,
    accepted: 0,
    duplicatesSkipped: 0,
    needsReview: 0,
    attendanceCreated: 0,
    attendanceUpdated: 0,
    reasons: [reason],
    notes: [],
    links: [],
  };
}

async function loadDevice(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
): Promise<AttendanceDeviceRow | null> {
  const { data } = await admin
    .from("attendance_devices")
    .select(
      "id, tenant_id, serial_number, status, timezone, site_code, contract_project, company_wide",
    )
    .eq("tenant_id", tenantId)
    .eq("id", deviceId)
    .maybeSingle();
  return (data as AttendanceDeviceRow | null) ?? null;
}

async function loadMappedEmployees(
  admin: SupabaseClient,
  tenantId: string,
  device: AttendanceDeviceRow,
  staffIds: string[] | null = null,
): Promise<SimEmployee[]> {
  const [pinsResult, employeesResult, context] = await Promise.all([
    admin
      .from("employee_biometric_ids")
      .select("staff_id, device_pin")
      .eq("tenant_id", tenantId),
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, shift, position, contract_project, employment_status",
      )
      .eq("tenant_id", tenantId)
      .eq("employment_status", "Active"),
    loadShiftScheduleContext(admin, tenantId),
  ]);
  const allowedStaff =
    staffIds === null ? null : new Set(staffIds);
  const pinByStaff = new Map<string, string>();
  for (const row of pinsResult.data ?? []) {
    const staffId = String(row.staff_id ?? "");
    const pin = String(row.device_pin ?? "").trim();
    if (staffId && pin) {
      pinByStaff.set(staffId, pin);
    }
  }
  const projects = context.projects as StaffGroupProject[];
  const groupKey = device.company_wide
    ? null
    : staffGroupKeyForProject(device.contract_project, projects);
  const employees: SimEmployee[] = [];
  for (const row of employeesResult.data ?? []) {
    const staffId = String(row.staff_id ?? "");
    if (allowedStaff !== null && !allowedStaff.has(staffId)) {
      continue;
    }
    const pin = pinByStaff.get(staffId);
    if (!pin) {
      continue;
    }
    if (
      !device.company_wide &&
      (!groupKey ||
        !employeeMatchesStaffGroup(
          row.contract_project == null ? null : String(row.contract_project),
          groupKey,
          projects,
        ))
    ) {
      continue;
    }
    employees.push({
      employee_id: String(row.employee_id ?? ""),
      staff_id: staffId,
      full_name: String(row.full_name ?? staffId),
      shift: row.shift == null ? null : String(row.shift),
      position: row.position == null ? null : String(row.position),
      contract_project:
        row.contract_project == null ? null : String(row.contract_project),
      pin,
    });
  }
  employees.sort((left, right) => left.staff_id.localeCompare(right.staff_id));
  return employees;
}

async function clocksFor(
  admin: SupabaseClient,
  tenantId: string,
  employee: SimEmployee,
  date: string,
): Promise<{ start: string; end: string }> {
  const context = await loadShiftScheduleContext(admin, tenantId);
  const roster: RosterCoverage[] =
    employee.shift === "Rotating" && employee.employee_id
      ? await rosterAssignmentsForEmployee(admin, tenantId, employee.employee_id)
      : [];
  const schedule = resolveExpectedSchedule({
    employee,
    date,
    projects: context.projects,
    sites: context.sites,
    rosterAssignments: roster,
    shiftTimes: context.shiftTimes,
    gracePolicy: context.grace,
    holidayDates: context.holidayDates,
  });
  if (!schedule) {
    return { start: DEFAULT_START, end: DEFAULT_END };
  }
  return { start: schedule.startTime, end: schedule.endTime };
}

async function postAttlog(
  origin: string,
  serial: string,
  body: string,
  table = "ATTLOG",
): Promise<{ httpOk: boolean; detail: string }> {
  const url = `${origin}/iclock/cdata?SN=${encodeURIComponent(serial)}&table=${encodeURIComponent(table)}&Stamp=9999`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body,
      cache: "no-store",
    });
    const text = await response.text();
    const httpOk = response.ok && text.trim().toUpperCase().startsWith("OK");
    return {
      httpOk,
      detail: httpOk ? "" : `Scanner endpoint answered ${response.status}: ${text.slice(0, 180)}`,
    };
  } catch (error) {
    return {
      httpOk: false,
      detail: error instanceof Error ? error.message : "Could not reach /iclock.",
    };
  }
}

async function punchesForLines(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
  rawLines: string[],
): Promise<PunchRow[]> {
  if (!rawLines.length) {
    return [];
  }
  const { data, error } = await admin
    .from("biometric_punches")
    .select(
      "id, raw_line, staff_id, process_note, attendance_register_id, device_pin, punch_local_date",
    )
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .in("raw_line", rawLines);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as PunchRow[];
}

async function attendanceFor(
  admin: SupabaseClient,
  tenantId: string,
  staffIds: string[],
  dates: string[],
): Promise<AttendanceRow[]> {
  if (!staffIds.length || !dates.length) {
    return [];
  }
  const { data, error } = await admin
    .from("attendance_register")
    .select(
      "id, staff_id, date, clock_in, clock_out, hours_worked, attendance_status, exception_status",
    )
    .eq("tenant_id", tenantId)
    .in("staff_id", staffIds)
    .in("date", dates);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as AttendanceRow[];
}

function attendanceKey(row: { staff_id: string; date: string }): string {
  return `${row.staff_id}|${String(row.date).slice(0, 10)}`;
}

function localEpochSeconds(localDateTime: string): number | null {
  const match = localDateTime
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  return (
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ) / 1000
  );
}

function runOffsetNote(before: string | undefined, after: string | undefined): string {
  const left = before ? localEpochSeconds(before) : null;
  const right = after ? localEpochSeconds(after) : null;
  if (left == null || right == null || left === right) {
    return "";
  }
  const minutes = Math.round((right - left) / 60);
  const direction = minutes > 0 ? "later" : "earlier";
  return ` Each stamp is ${Math.abs(minutes)} min ${direction} so this run does not reuse the previous punch.`;
}

function storedPunchLocal(iso: string, timeZone: string): string | null {
  if (!Number.isFinite(Date.parse(iso))) {
    return null;
  }
  const date = localDateInZone(iso, timeZone);
  let time = formatTimeInZone(iso, timeZone);
  if (time.startsWith("24:")) {
    time = `00:${time.slice(3)}`;
  }
  return `${date} ${time}`;
}

async function takenPunchKeys(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
  timeZone: string,
  pins: string[],
): Promise<Set<string>> {
  const uniquePins = [...new Set(pins.map((pin) => pin.trim()).filter(Boolean))];
  if (!uniquePins.length) {
    return new Set();
  }
  const { data, error } = await admin
    .from("biometric_punches")
    .select("device_pin, punch_time")
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .in("device_pin", uniquePins)
    .limit(5000);
  if (error) {
    throw new Error(error.message);
  }
  const taken = new Set<string>();
  for (const row of data ?? []) {
    const pin = String(row.device_pin ?? "").trim();
    const local = storedPunchLocal(String(row.punch_time ?? ""), timeZone);
    if (pin && local) {
      taken.add(`${pin}|${local}`);
    }
  }
  return taken;
}

async function simulatorUnknownPinsInUse(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("biometric_punches")
    .select("device_pin")
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .like("device_pin", "900000%")
    .limit(1000);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? [])
    .map((row) => String(row.device_pin ?? "").trim())
    .filter((pin) => isSimulatorUnknownPin(pin));
}

async function freshenAgainstDevice(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
  timeZone: string,
  punches: PlannedPunch[],
): Promise<PlannedPunch[]> {
  const taken = await takenPunchKeys(
    admin,
    tenantId,
    deviceId,
    timeZone,
    punches.map((punch) => punch.pin),
  );
  return freshenFixedPunches({ punches, taken });
}

function buildCard(input: {
  scenario: SimulatorScenarioId;
  linesSent: number;
  accepted: number;
  duplicatesSkipped: number;
  needsReview: number;
  attendanceCreated: number;
  attendanceUpdated: number;
  httpOk: boolean;
  httpDetail: string;
  processingErrors: number;
  punches: PunchRow[];
  created: AttendanceRow[];
  updated: AttendanceRow[];
  expected: ReturnType<typeof expectationForCountedScenario>;
  replayBody?: string;
  extraReasons?: string[];
  attendanceSnapshot?: AttendanceRow | null;
}): SimulatorResultCard {
  if (input.scenario === "single_punch") {
    const verdict = singlePunchCardVerdict({
      httpOk: input.httpOk,
      httpDetail: input.httpDetail,
      processingErrors: input.processingErrors,
      accepted: input.accepted,
      duplicatesSkipped: input.duplicatesSkipped,
      punchNotes: input.punches.map((punch) => punch.process_note ?? ""),
    });
    return {
      scenario: input.scenario,
      title: simulatorScenarioTitle(input.scenario),
      pass: verdict.kind !== "error",
      resultKind: verdict.kind,
      linesSent: input.linesSent,
      accepted: input.accepted,
      duplicatesSkipped: input.duplicatesSkipped,
      needsReview: input.needsReview,
      attendanceCreated: input.attendanceCreated,
      attendanceUpdated: input.attendanceUpdated,
      reasons: verdict.reasons,
      notes: input.extraReasons ?? [],
      links: [],
      attendance: simulatorAttendanceSnapshot(input.attendanceSnapshot ?? null),
      replayBody: input.replayBody,
    };
  }
  const graded = gradeScenario({
    httpOk: input.httpOk,
    processingErrors: input.processingErrors,
    linesSent: input.linesSent,
    accepted: input.accepted,
    duplicatesSkipped: input.duplicatesSkipped,
    needsReview: input.needsReview,
    attendanceCreated: input.attendanceCreated,
    attendanceUpdated: input.attendanceUpdated,
    expected: input.expected,
  });
  const reasons = [...graded.reasons];
  if (input.httpDetail) {
    reasons.unshift(input.httpDetail);
  }
  const noteSummary = [
    ...new Set(
      input.punches
        .map((punch) => (punch.process_note ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (!graded.pass && noteSummary.length > 0) {
    reasons.push(`Punch notes: ${noteSummary.join(", ")}.`);
  }
  const links = [
    ...input.created.slice(0, 8).map((row) => ({
      href: "/dashboard/hr-payroll/attendance",
      label: `Attendance ${row.staff_id} · ${String(row.date).slice(0, 10)}`,
    })),
    ...input.updated.slice(0, 4).map((row) => ({
      href: "/dashboard/hr-payroll/attendance",
      label: `Updated ${row.staff_id} · ${String(row.date).slice(0, 10)}`,
    })),
    ...input.punches
      .filter((punch) => punchSentToNeedsReview(punch))
      .slice(0, 6)
      .map((punch) => ({
        href: "/dashboard/devices?tab=attendance",
        label: `Needs review · PIN ${punch.device_pin ?? "—"}`,
      })),
  ];
  return {
    scenario: input.scenario,
    title: simulatorScenarioTitle(input.scenario),
    pass: reasons.length === 0,
    resultKind: "graded",
    linesSent: input.linesSent,
    accepted: input.accepted,
    duplicatesSkipped: input.duplicatesSkipped,
    needsReview: input.needsReview,
    attendanceCreated: input.attendanceCreated,
    attendanceUpdated: input.attendanceUpdated,
    reasons,
    notes: input.extraReasons ?? [],
    links,
    replayBody: input.replayBody,
  };
}

async function executeAttlog(input: {
  admin: SupabaseClient;
  origin: string;
  device: AttendanceDeviceRow;
  scenario: SimulatorScenarioId;
  punches: PlannedPunch[];
  expected: ReturnType<typeof expectationForCountedScenario>;
  replayBody?: string;
  extraReasons?: string[];
}): Promise<SimulatorResultCard> {
  const body = formatAttlogBody(input.punches);
  const rawLines = input.punches.map(
    (punch) =>
      `${punch.pin} ${punch.localDateTime} ${punch.statusCode} 1 ${SIMULATOR_WORK_CODE}`,
  );
  const staffPins = new Map(input.punches.map((punch) => [punch.pin, punch.pin]));
  const dates = [
    ...new Set(input.punches.map((punch) => punch.localDateTime.slice(0, 10))),
  ];
  const { data: pinRows } = await input.admin
    .from("employee_biometric_ids")
    .select("staff_id, device_pin")
    .eq("tenant_id", input.device.tenant_id);
  const staffIds = [
    ...new Set(
      (pinRows ?? [])
        .filter((row) => staffPins.has(String(row.device_pin ?? "").trim()))
        .map((row) => String(row.staff_id)),
    ),
  ];
  const beforePunches = await punchesForLines(
    input.admin,
    input.device.tenant_id,
    input.device.id,
    rawLines,
  );
  const beforeAttendance = await attendanceFor(
    input.admin,
    input.device.tenant_id,
    staffIds,
    dates,
  );
  const posted = await postAttlog(
    input.origin,
    input.device.serial_number ?? "",
    body,
  );
  const afterPunches = await punchesForLines(
    input.admin,
    input.device.tenant_id,
    input.device.id,
    rawLines,
  );
  const afterAttendance = await attendanceFor(
    input.admin,
    input.device.tenant_id,
    staffIds,
    dates,
  );
  const beforeLines = new Set(
    beforePunches.map((punch) => String(punch.raw_line ?? "")),
  );
  const acceptedPunches = afterPunches.filter(
    (punch) => !beforeLines.has(String(punch.raw_line ?? "")),
  );
  const duplicatesSkipped = rawLines.filter((line) => beforeLines.has(line)).length;
  const beforeKeys = new Set(beforeAttendance.map(attendanceKey));
  const beforeByKey = new Map(beforeAttendance.map((row) => [attendanceKey(row), row]));
  const created = afterAttendance.filter((row) => !beforeKeys.has(attendanceKey(row)));
  const updated = afterAttendance.filter((row) => {
    const previous = beforeByKey.get(attendanceKey(row));
    if (!previous) {
      return false;
    }
    return previous.clock_in !== row.clock_in || previous.clock_out !== row.clock_out;
  });
  const processingErrors = acceptedPunches.filter(
    (punch) => punch.process_note === "processing_error",
  ).length;
  const punchDate = dates[0] ?? "";
  const snapshot =
    input.scenario === "single_punch"
      ? (afterAttendance.find(
          (row) => String(row.date).slice(0, 10) === punchDate,
        ) ?? null)
      : null;
  return buildCard({
    scenario: input.scenario,
    linesSent: rawLines.length,
    accepted: acceptedPunches.length,
    duplicatesSkipped,
    needsReview: acceptedPunches.filter((punch) => punchSentToNeedsReview(punch))
      .length,
    attendanceCreated: created.length,
    attendanceUpdated: updated.length,
    httpOk: posted.httpOk,
    httpDetail: posted.detail,
    processingErrors,
    punches: acceptedPunches,
    created,
    updated,
    expected: input.expected,
    replayBody: input.replayBody ?? body,
    extraReasons: input.extraReasons,
    attendanceSnapshot: snapshot,
  });
}

export async function listSimulatorEmployees(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
  staffIds: string[] | null = null,
): Promise<SimulatorEmployeeOption[]> {
  const device = await loadDevice(admin, tenantId, deviceId);
  if (!device) {
    return [];
  }
  const employees = await loadMappedEmployees(
    admin,
    tenantId,
    device,
    staffIds,
  );
  return employees.map((employee) => ({
    staffId: employee.staff_id,
    fullName: employee.full_name,
    pin: employee.pin,
  }));
}

export async function runScannerScenario(input: {
  admin: SupabaseClient;
  origin: string;
  tenantId: string;
  deviceId: string;
  scenario: SimulatorScenarioId;
  weekStart?: string | null;
  pin?: string | null;
  localDateTime?: string | null;
  direction?: "in" | "out" | null;
  replayBody?: string | null;
}): Promise<SimulatorResultCard> {
  const device = await loadDevice(input.admin, input.tenantId, input.deviceId);
  if (!device) {
    return failedCard(input.scenario, "This attendance device was not found.");
  }
  if (!device.serial_number) {
    return failedCard(
      input.scenario,
      "This simulator only works with ZKTeco devices that have a serial number.",
    );
  }
  if (device.status === "disabled") {
    return failedCard(
      input.scenario,
      "This device is disabled, so /iclock ignores its uploads.",
    );
  }
  const serialNumber = device.serial_number;

  const today = localDateInZone(new Date().toISOString(), "Africa/Accra");
  const week = input.weekStart ? mondayOf(input.weekStart) : "";
  if (
    input.scenario !== "single_punch" &&
    input.scenario !== "heartbeat" &&
    input.scenario !== "non_attlog" &&
    input.scenario !== "resend_batch" &&
    (!week || !weekIsPast(week, today))
  ) {
    return failedCard(
      input.scenario,
      "Choose a week that has already ended so future-time holds do not apply.",
    );
  }

  if (input.scenario === "heartbeat") {
    let accepted = 0;
    let detail = "";
    for (let index = 0; index < SIMULATOR_HEARTBEAT_CALLS; index += 1) {
      try {
        const response = await fetch(
          `${input.origin}/iclock/getrequest?SN=${encodeURIComponent(serialNumber)}`,
          { cache: "no-store" },
        );
        const text = await response.text();
        if (response.ok && text.trim().toUpperCase().startsWith("OK")) {
          accepted += 1;
        } else if (!detail) {
          detail = `Heartbeat answered ${response.status}: ${text.slice(0, 120)}`;
        }
      } catch (error) {
        detail = error instanceof Error ? error.message : "Heartbeat failed.";
        break;
      }
    }
    return buildCard({
      scenario: "heartbeat",
      linesSent: SIMULATOR_HEARTBEAT_CALLS,
      accepted,
      duplicatesSkipped: 0,
      needsReview: 0,
      attendanceCreated: 0,
      attendanceUpdated: 0,
      httpOk: accepted === SIMULATOR_HEARTBEAT_CALLS,
      httpDetail: detail,
      processingErrors: 0,
      punches: [],
      created: [],
      updated: [],
      expected: expectationForCountedScenario({
        linesSent: SIMULATOR_HEARTBEAT_CALLS,
        accepted: SIMULATOR_HEARTBEAT_CALLS,
        duplicatesSkipped: 0,
        attendanceMin: 0,
        attendanceMax: 0,
        needsReviewMin: 0,
        needsReviewMax: 0,
      }),
    });
  }

  if (input.scenario === "non_attlog") {
    const date = week && weekIsPast(week, today) ? addDays(week, 6) : addDays(today, -7);
    const body = nonAttlogBody(date);
    const { count: beforeCount } = await input.admin
      .from("biometric_punches")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("device_id", device.id);
    const posted = await postAttlog(input.origin, serialNumber, body, "OPERLOG");
    const { count: afterCount } = await input.admin
      .from("biometric_punches")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", input.tenantId)
      .eq("device_id", device.id);
    const accepted = Math.max(0, (afterCount ?? 0) - (beforeCount ?? 0));
    return buildCard({
      scenario: "non_attlog",
      linesSent: nonAttlogLineCount(body),
      accepted,
      duplicatesSkipped: 0,
      needsReview: 0,
      attendanceCreated: 0,
      attendanceUpdated: 0,
      httpOk: posted.httpOk,
      httpDetail: posted.detail,
      processingErrors: 0,
      punches: [],
      created: [],
      updated: [],
      expected: expectationForCountedScenario({
        linesSent: nonAttlogLineCount(body),
        accepted: 0,
        duplicatesSkipped: 0,
        attendanceMin: 0,
        attendanceMax: 0,
        needsReviewMin: 0,
        needsReviewMax: 0,
      }),
    });
  }

  const employees = await loadMappedEmployees(input.admin, input.tenantId, device);
  const timeZone = deviceTimezoneOrDefault(device.timezone);

  if (input.scenario === "resend_batch") {
    const body = input.replayBody?.trim() ?? "";
    if (!body) {
      return failedCard("resend_batch", "Run the offline batch first, then re-send it.");
    }
    const planned = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/\s+/);
        return {
          pin: parts[0] ?? "",
          localDateTime: `${parts[1] ?? ""} ${parts[2] ?? ""}`.trim(),
          statusCode: (parts[3] === "1" ? 1 : 0) as 0 | 1,
        };
      });
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "resend_batch",
      punches: planned,
      replayBody: body,
      expected: expectationForCountedScenario({
        linesSent: planned.length,
        accepted: 0,
        duplicatesSkipped: planned.length,
        attendanceMin: 0,
        attendanceMax: 0,
        needsReviewMin: 0,
        needsReviewMax: 0,
      }),
    });
  }

  if (input.scenario === "unknown_pin") {
    const date = week && weekIsPast(week, today) ? addDays(week, 6) : addDays(today, -8);
    const usedPins = await simulatorUnknownPinsInUse(
      input.admin,
      input.tenantId,
      device.id,
    );
    const pin = unusedSimulatorPin([
      ...employees.map((employee) => employee.pin),
      ...usedPins,
    ]);
    const punches = await freshenAgainstDevice(
      input.admin,
      input.tenantId,
      device.id,
      timeZone,
      planUnknownPin(date, pin),
    );
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "unknown_pin",
      punches,
      expected: expectationForCountedScenario({
        linesSent: 1,
        accepted: 1,
        duplicatesSkipped: 0,
        attendanceMin: 0,
        attendanceMax: 0,
        needsReviewMin: 1,
        needsReviewMax: 1,
      }),
    });
  }

  if (!employees.length) {
    return failedCard(
      input.scenario,
      "No active employee in this device's staff group has a device PIN.",
    );
  }

  if (input.scenario === "single_punch") {
    const pin = input.pin?.trim() || employees[0]!.pin;
    const localDateTime = input.localDateTime?.trim();
    if (!localDateTime) {
      return failedCard("single_punch", "Choose a date and time.");
    }
    const taken = await takenPunchKeys(
      input.admin,
      input.tenantId,
      device.id,
      timeZone,
      [pin],
    );
    const planned = singlePunchSendPlan({
      pin,
      localDateTime,
      direction: input.direction === "out" ? "out" : "in",
      taken,
    });
    if ("error" in planned) {
      return failedCard("single_punch", planned.error);
    }
    const punches = planned.punches;
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "single_punch",
      punches,
      expected: expectationForCountedScenario({
        linesSent: punches.length,
        accepted: punches.length,
        duplicatesSkipped: 0,
        attendanceMin: 0,
        needsReviewMin: 0,
      }),
    });
  }

  if (!week || !weekIsPast(week, today)) {
    return failedCard(
      input.scenario,
      "Choose a week that has already ended so future-time holds do not apply.",
    );
  }

  const first = employees[0]!;
  if (input.scenario === "staff_group_day") {
    const date = addDays(week, 1);
    const people = [];
    for (const employee of employees) {
      const clocks = await clocksFor(input.admin, input.tenantId, employee, date);
      people.push({ pin: employee.pin, ...clocks });
    }
    const punches = planStaffGroupDay({
      date,
      people,
      seed: device.id.length + date.length,
    });
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "staff_group_day",
      punches,
      expected: staffGroupDayExpectation(employees.length, punches.length),
    });
  }

  if (input.scenario === "offline_batch") {
    const punches = planOfflineBatch({
      dates: [addDays(week, 2), addDays(week, 3), addDays(week, 4)],
      pins: employees.map((employee) => employee.pin),
      seed: serialNumber.length * 17 + week.length,
    });
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "offline_batch",
      punches,
      replayBody: formatAttlogBody(punches),
      expected: offlineBatchExpectation(
        punches.length,
        new Set(
          punches.map(
            (punch) => `${punch.pin}|${punch.localDateTime.slice(0, 10)}`,
          ),
        ).size,
      ),
    });
  }

  if (input.scenario === "clock_drift") {
    const date = addDays(week, 5);
    const clocks = await clocksFor(input.admin, input.tenantId, first, date);
    const planned = planClockDrift({ date, pin: first.pin, ...clocks });
    const punches = simulatorPunchesToSend({
      scenario: "clock_drift",
      punches: planned,
    });
    return executeAttlog({
      admin: input.admin,
      origin: input.origin,
      device,
      scenario: "clock_drift",
      punches,
      extraReasons: [
        `Stamped ${punches[0]?.localDateTime ?? ""} (7 min fast) and ${punches[1]?.localDateTime ?? ""} (3 min slow).${runOffsetNote(planned[0]?.localDateTime, punches[0]?.localDateTime)}`,
      ],
      expected: pairedDayExpectation(),
    });
  }

  const date = addDays(week, 6);
  const clocks = await clocksFor(input.admin, input.tenantId, first, date);
  const planned = planWrongTimezone({ date, pin: first.pin, ...clocks });
  const punches = simulatorPunchesToSend({
    scenario: "wrong_timezone",
    punches: planned,
  });
  return executeAttlog({
    admin: input.admin,
    origin: input.origin,
    device,
    scenario: "wrong_timezone",
    punches,
    extraReasons: [
      `Stamped 1 hour ahead: ${punches[0]?.localDateTime ?? ""} and ${punches[1]?.localDateTime ?? ""}.${runOffsetNote(planned[0]?.localDateTime, punches[0]?.localDateTime)}`,
    ],
    expected: pairedDayExpectation(),
  });
}

export async function runAllScannerScenarios(input: {
  admin: SupabaseClient;
  origin: string;
  tenantId: string;
  deviceId: string;
  weekStart: string;
}): Promise<SimulatorResultCard[]> {
  const order: SimulatorScenarioId[] = [
    "heartbeat",
    "non_attlog",
    "unknown_pin",
    "single_punch",
    "staff_group_day",
    "offline_batch",
    "resend_batch",
    "clock_drift",
    "wrong_timezone",
  ];
  const device = await loadDevice(input.admin, input.tenantId, input.deviceId);
  const employees = device
    ? await loadMappedEmployees(input.admin, input.tenantId, device)
    : [];
  const week = mondayOf(input.weekStart);
  const first = employees[0];
  const cards: SimulatorResultCard[] = [];
  let replayBody = "";
  for (const scenario of order) {
    const card = await runScannerScenario({
      admin: input.admin,
      origin: input.origin,
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      scenario,
      weekStart: week,
      pin: first?.pin,
      localDateTime:
        scenario === "single_punch" && first
          ? `${week} 08:00:00`
          : null,
      direction: "in",
      replayBody: scenario === "resend_batch" ? replayBody : null,
    });
    if (scenario === "offline_batch" && card.replayBody) {
      replayBody = card.replayBody;
    }
    cards.push(card);
  }
  return cards;
}

export async function cleanupSimulatorData(
  admin: SupabaseClient,
  tenantId: string,
  deviceId: string,
): Promise<{
  punchesDeleted: number;
  attendanceRowsDeleted: number;
  mixedRowsKept: number;
}> {
  const tagged = await admin
    .from("biometric_punches")
    .select("id, attendance_register_id, work_code, device_pin, staff_id")
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .eq("work_code", SIMULATOR_WORK_CODE);
  if (tagged.error) {
    throw new Error(tagged.error.message);
  }
  const unknownPins = await admin
    .from("biometric_punches")
    .select("id, attendance_register_id, work_code, device_pin, staff_id")
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .is("staff_id", null)
    .like("device_pin", "900000%");
  if (unknownPins.error) {
    throw new Error(unknownPins.error.message);
  }
  const punches = [
    ...new Map(
      [...(tagged.data ?? []), ...(unknownPins.data ?? [])]
        .filter((row) => simulatorPunchIsCleanupTarget(row))
        .map((row) => [String(row.id), row]),
    ).values(),
  ];
  const registerIds = [
    ...new Set(
      punches
        .map((row) => (row.attendance_register_id == null ? "" : String(row.attendance_register_id)))
        .filter(Boolean),
    ),
  ];
  const safeRegisterIds: string[] = [];
  let mixedRowsKept = 0;
  for (const registerId of registerIds) {
    const { data: linked, error: linkedError } = await admin
      .from("biometric_punches")
      .select("id, work_code, device_pin, staff_id")
      .eq("tenant_id", tenantId)
      .eq("attendance_register_id", registerId);
    if (linkedError) {
      throw new Error(linkedError.message);
    }
    const others = (linked ?? []).filter(
      (row) => !simulatorPunchIsCleanupTarget(row),
    );
    if (others.length === 0) {
      safeRegisterIds.push(registerId);
    } else {
      mixedRowsKept += 1;
    }
  }

  const punchIds = punches.map((row) => String(row.id));
  for (let index = 0; index < punchIds.length; index += 100) {
    const chunk = punchIds.slice(index, index + 100);
    const { error: deleteError } = await admin
      .from("biometric_punches")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("device_id", deviceId)
      .in("id", chunk);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  let attendanceRowsDeleted = 0;
  for (const registerId of safeRegisterIds) {
    const { data: remaining, error: remainingError } = await admin
      .from("biometric_punches")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("attendance_register_id", registerId);
    if (remainingError) {
      throw new Error(remainingError.message);
    }
    if ((remaining ?? []).length > 0) {
      mixedRowsKept += 1;
      continue;
    }
    const { error: registerError, count } = await admin
      .from("attendance_register")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .eq("id", registerId)
      .eq("source", "device")
      .eq("device_id", deviceId);
    if (registerError) {
      throw new Error(registerError.message);
    }
    if ((count ?? 0) > 0) {
      attendanceRowsDeleted += 1;
    }
  }

  return {
    punchesDeleted: punchIds.length,
    attendanceRowsDeleted,
    mixedRowsKept,
  };
}
