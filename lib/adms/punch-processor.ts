import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isScannerClockDriftNote } from "@/lib/adms/device-clock";
import {
  filterDuplicateTaps,
  groupPunchesIntoSessions,
  hoursWorkedBetween,
  recomputeSessionClocks,
  registerSessionStartIso,
  registerSessionWindowOpen,
  sessionWindowHasClosed,
  type OpenSessionAnchor,
} from "@/lib/adms/punch-session-utils";
import { sessionProcessNote } from "@/lib/adms/punch-contract";
import type { StaffGroupProject } from "@/lib/attendance-staff-groups";
import { logAdmsEvent } from "@/lib/adms/log-adms-event";
import {
  PROCESSING_ERROR_LOG_WINDOW_MS,
  processingErrorAlreadyLogged,
  processingErrorLogKey,
  punchNeedsProcessing,
} from "@/lib/adms/punch-eligibility";
import {
  formatTimeInZone,
  localDateInZone,
  deviceTimezoneOrDefault,
} from "@/lib/adms/timezone-utils";
import {
  loadShiftScheduleContext,
  rosterAssignmentsForEmployee,
  scheduleColumnsForEmployee,
} from "@/lib/shift-attendance-context";
import { isReviewedException } from "@/lib/shift-attendance";
import {
  loadAttendanceModeForStaff,
  loadAttendanceModesForStaff,
} from "@/lib/attendance-mode-service";

type DeviceRow = {
  id: string;
  tenant_id: string;
  site_code: string | null;
  timezone: string | null;
  contract_project: string | null;
  company_wide: boolean;
};

type PunchRow = {
  id: string;
  tenant_id: string;
  staff_id: string | null;
  device_pin: string;
  device_id: string | null;
  punch_time: string;
  status_code?: number | null;
  process_note: string | null;
  processed_at: string | null;
};

async function loadEmployeeAttendanceDefaults(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<{
  employment_type: string | null;
  project_assignment: string | null;
  assigned_site_id: string | null;
  employee_id: string | null;
  position: string | null;
  shift: string | null;
}> {
  const { data } = await admin
    .from("employees")
    .select(
      "employee_id, employment_type, contract_project, assigned_site_id, position, shift",
    )
    .eq("tenant_id", tenantId)
    .eq("staff_id", staffId)
    .maybeSingle();

  return {
    employment_type: data?.employment_type ?? null,
    project_assignment: data?.contract_project ?? null,
    assigned_site_id: data?.assigned_site_id ?? null,
    employee_id: data?.employee_id ?? null,
    position: data?.position ?? null,
    shift: data?.shift ?? null,
  };
}

/**
 * Exempt staff (attendance mode) never get missing-clock, late or early-leave
 * exceptions. A failed lookup keeps the standard behaviour so punches still
 * process.
 */
async function isStaffAttendanceExempt(
  admin: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<boolean> {
  try {
    return (
      (await loadAttendanceModeForStaff(admin, tenantId, staffId)) === "exempt"
    );
  } catch {
    return false;
  }
}

const recentProcessingErrorLogs: { key: string; atMs: number }[] = [];

async function reportProcessingFailure(
  admin: SupabaseClient,
  tenantId: string,
  punchIds: string[],
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const nowMs = Date.now();
  if (
    processingErrorAlreadyLogged(
      recentProcessingErrorLogs,
      message,
      punchIds,
      nowMs,
    )
  ) {
    return;
  }

  const since = new Date(nowMs - PROCESSING_ERROR_LOG_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from("system_event_log")
    .select("message, metadata, created_at")
    .eq("event_name", "adms_punch_processing_error")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);
  const previous = (recent ?? []).map((row) => {
    const metadata = (row.metadata ?? {}) as { punch_ids?: unknown };
    const ids = Array.isArray(metadata.punch_ids)
      ? metadata.punch_ids.map((id) => String(id))
      : [];
    return {
      key: processingErrorLogKey(String(row.message ?? ""), ids),
      atMs: Date.parse(String(row.created_at ?? "")),
    };
  });
  if (processingErrorAlreadyLogged(previous, message, punchIds, nowMs)) {
    recentProcessingErrorLogs.push({
      key: processingErrorLogKey(message, punchIds),
      atMs: nowMs,
    });
    return;
  }

  const key = processingErrorLogKey(message, punchIds);
  const cutoff = nowMs - PROCESSING_ERROR_LOG_WINDOW_MS;
  for (let index = recentProcessingErrorLogs.length - 1; index >= 0; index -= 1) {
    if (recentProcessingErrorLogs[index].atMs < cutoff) {
      recentProcessingErrorLogs.splice(index, 1);
    }
  }
  recentProcessingErrorLogs.push({ key, atMs: nowMs });
  await logAdmsEvent({
    eventName: "adms_punch_processing_error",
    status: "failure",
    message,
    metadata: {
      tenant_id: tenantId,
      punch_ids: punchIds,
      error: message,
    },
  });
}

async function markProcessingError(
  admin: SupabaseClient,
  tenantId: string,
  punchIds: string[],
): Promise<void> {
  if (!punchIds.length) {
    return;
  }
  await admin
    .from("biometric_punches")
    .update({ process_note: "processing_error" })
    .eq("tenant_id", tenantId)
    .in("id", punchIds);
}

export async function processBiometricPunchesForTenant(
  admin: SupabaseClient,
  tenantId: string,
  options?: {
    staffIds?: string[];
    device?: DeviceRow | null;
    /** When set, only punches at or before this instant are processed. */
    olderThanIso?: string | null;
    /** Clock for future-punch release and the 16-hour session window. */
    nowMs?: number;
    /**
     * Hub refresh: release punches whose timestamp has arrived, and refresh
     * open-session notes. Does not reprocess every other stuck punch.
     */
    dueFutureOnly?: boolean;
    /**
     * Retry punches already marked processing_error. Set only for an explicit
     * Reprocess or a new ingest for the same PIN — never the hub refresh.
     */
    retryProcessingErrors?: boolean;
    /** Limit processing to these punch ids. Other punches are left alone. */
    punchIds?: string[];
  },
): Promise<void> {
  const nowMs = options?.nowMs ?? Date.now();
  const punchSelect =
    "id, tenant_id, staff_id, device_pin, punch_time, status_code, process_note, processed_at, device_id";

  const loadedById = new Map<string, PunchRow>();

  if (!options?.dueFutureOnly) {
    let query = admin
      .from("biometric_punches")
      .select(punchSelect)
      .eq("tenant_id", tenantId)
      .is("processed_at", null)
      .not("staff_id", "is", null);

    if (options?.staffIds?.length) {
      query = query.in("staff_id", options.staffIds);
    }
    if (options?.punchIds?.length) {
      query = query.in("id", options.punchIds);
    }
    if (options?.olderThanIso) {
      query = query.lt("punch_time", options.olderThanIso);
    }

    const { data: loadedRows, error } = await query;
    if (error) {
      await reportProcessingFailure(admin, tenantId, [], error.message);
      await syncOpenSessionReviewNotes(admin, tenantId, nowMs);
      return;
    }
    for (const row of (loadedRows ?? []) as PunchRow[]) {
      loadedById.set(row.id, row);
    }
  }

  // Due future punches are not limited by the 2-minute reprocess cutoff.
  let futureQuery = admin
    .from("biometric_punches")
    .select(punchSelect)
    .eq("tenant_id", tenantId)
    .eq("process_note", "future_time")
    .is("processed_at", null)
    .not("staff_id", "is", null);
  if (options?.punchIds?.length) {
    futureQuery = futureQuery.in("id", options.punchIds);
  }
  const { data: futureRows, error: futureError } = await futureQuery;
  if (futureError) {
    await reportProcessingFailure(admin, tenantId, [], futureError.message);
  } else {
    for (const row of (futureRows ?? []) as PunchRow[]) {
      loadedById.set(row.id, row);
    }
  }

  // Keep this filter in memory. PostgREST `neq` is SQL `<>`, which rejects NULL
  // process_note, so a freshly stored punch would never be processed.
  const punchRows = [...loadedById.values()].filter((row) =>
    punchNeedsProcessing(row, options?.olderThanIso, nowMs, {
      retryProcessingErrors: options?.retryProcessingErrors === true,
    }),
  );
  if (!punchRows.length) {
    await syncOpenSessionReviewNotes(admin, tenantId, nowMs);
    return;
  }

  try {
  const staffGroupProjects = await loadStaffGroupProjects(admin, tenantId);
  const shiftContext = await loadShiftScheduleContext(admin, tenantId);
  const devicesById = await loadDevicesForPunches(
    admin,
    tenantId,
    punchRows as PunchRow[],
    options?.device ?? null,
  );
  const fallbackDevice =
    options?.device ??
    devicesById.get(String((punchRows[0] as PunchRow | undefined)?.device_id ?? "")) ??
    null;
  const timeZone = deviceTimezoneOrDefault(fallbackDevice?.timezone);

  const byStaff = new Map<string, PunchRow[]>();
  for (const row of punchRows as PunchRow[]) {
    if (!row.staff_id) {
      continue;
    }
    const list = byStaff.get(row.staff_id) ?? [];
    list.push(row);
    byStaff.set(row.staff_id, list);
  }

  const openSessions = await loadOpenSessionAnchors(
    admin,
    tenantId,
    [...byStaff.keys()],
    nowMs,
  );

  for (const [staffId, staffPunches] of byStaff) {
    try {
    const sorted = [...staffPunches].sort(
      (a, b) => Date.parse(a.punch_time) - Date.parse(b.punch_time),
    );
    const { kept: keptPunches, duplicateIndices } = filterDuplicateTaps(
      sorted.map((punch) => ({
        ...punch,
        punchTimeIso: punch.punch_time,
      })),
    );
    for (const index of duplicateIndices) {
      const punch = sorted[index];
      if (!punch) {
        continue;
      }
      await admin
        .from("biometric_punches")
        .update({
          processed_at: new Date().toISOString(),
          process_note: "duplicate_tap",
        })
        .eq("tenant_id", tenantId)
        .eq("id", punch.id);
    }
    const kept = keptPunches as PunchRow[];

    const sessions = groupPunchesIntoSessions(
      kept.map((p) => ({
        id: p.id,
        staffId,
        punchTimeIso: p.punch_time,
      })),
      (iso) => localDateInZone(iso, timeZone),
      openSessions,
    );

    const employeeDefaults = await loadEmployeeAttendanceDefaults(
      admin,
      tenantId,
      staffId,
    );
    const rosterAssignments =
      employeeDefaults.shift === "Rotating" && employeeDefaults.employee_id
        ? await rosterAssignmentsForEmployee(
            admin,
            tenantId,
            employeeDefaults.employee_id,
          )
        : [];
    const exemptFromExceptions = await isStaffAttendanceExempt(
      admin,
      tenantId,
      staffId,
    );

    for (const session of sessions) {
      const { data: existing } = await admin
        .from("attendance_register")
        .select("id, source, exception_status, clock_in, clock_out")
        .eq("tenant_id", tenantId)
        .eq("staff_id", staffId)
        .eq("date", session.sessionDate)
        .maybeSingle();

      const protectedSources = new Set([
        "manual",
        "import",
        "remote",
        "outage",
        "api",
      ]);
      if (existing && protectedSources.has(String(existing.source ?? ""))) {
        await markPunchesProcessed(admin, tenantId, session.punchIds, {
          process_note: "manual_row_exists",
          attendance_register_id: existing.id,
        });
        continue;
      }

      let clockInIso = session.clockInIso;
      let clockOutIso = session.clockOutIso;
      let punchIds = session.punchIds;
      let missingClockOut = session.missingClockOut;
      if (existing && String(existing.source ?? "device") === "device") {
        const { data: linked } = await admin
          .from("biometric_punches")
          .select("id, punch_time, status_code, process_note")
          .eq("tenant_id", tenantId)
          .eq("attendance_register_id", existing.id);
        const mergedPunches = [
          ...(linked ?? [])
            .filter((punch) => {
              const note = String(punch.process_note ?? "");
              return note !== "duplicate_tap" && !note.endsWith(":dismissed");
            })
            .map((punch) => ({
              id: String(punch.id),
              punchTimeIso: String(punch.punch_time),
              statusCode:
                punch.status_code == null ? null : Number(punch.status_code),
            })),
          ...kept
            .filter((punch) => session.punchIds.includes(punch.id))
            .map((punch) => ({
              id: punch.id,
              punchTimeIso: punch.punch_time,
              statusCode: punch.status_code ?? null,
            })),
        ];
        const merged = recomputeSessionClocks(mergedPunches);
        if (merged) {
          clockInIso = merged.clockInIso;
          clockOutIso = merged.clockOutIso;
          punchIds = merged.punchIds;
          missingClockOut = merged.missingClockOut;
        }
      }

      const reviewed = isReviewedException(
        existing?.exception_status == null
          ? null
          : String(existing.exception_status),
      );

      const sessionPunch = kept.find((punch) => punch.device_id) ?? kept[0];
      const sessionDevice = sessionPunch?.device_id
        ? (devicesById.get(sessionPunch.device_id) ?? fallbackDevice)
        : fallbackDevice;
      const clockIn = formatTimeInZone(clockInIso, timeZone);
      const clockOut = clockOutIso
        ? formatTimeInZone(clockOutIso, timeZone)
        : null;
      const hoursWorked =
        clockOutIso != null
          ? hoursWorkedBetween(clockInIso, clockOutIso)
          : null;
      // No staff group (null contract_project, not company-wide) still records
      // attendance. other_contract applies only when the device has a contract.
      const processNote = sessionProcessNote({
        companyWide: sessionDevice?.company_wide === true,
        deviceContractProject: sessionDevice?.contract_project,
        employeeContractProject: employeeDefaults.project_assignment,
        missingClockOut:
          !exemptFromExceptions &&
          missingClockOut &&
          sessionWindowHasClosed(clockInIso, nowMs),
        projects: staffGroupProjects,
      });

      const scheduleColumns = scheduleColumnsForEmployee({
        context: shiftContext,
        employee: {
          employee_id: employeeDefaults.employee_id ?? "",
          position: employeeDefaults.position,
          shift: employeeDefaults.shift,
          contract_project: employeeDefaults.project_assignment,
        },
        rosterAssignments,
        date: session.sessionDate,
        clockIn,
        clockOut,
        existingExceptionStatus: null,
        exempt: exemptFromExceptions,
      });
      const schedulePayload: Record<string, unknown> | null = scheduleColumns
        ? { ...scheduleColumns }
        : null;
      if (schedulePayload && reviewed) {
        delete schedulePayload.exception_status;
        delete schedulePayload.attendance_status;
      }
      const rowPayload: Record<string, unknown> = {
        tenant_id: tenantId,
        date: session.sessionDate,
        staff_id: staffId,
        employment_type: employeeDefaults.employment_type,
        project_assignment: employeeDefaults.project_assignment,
        clock_in: clockIn,
        clock_out: clockOut,
        hours_worked: hoursWorked,
        overtime_hours: null,
        source: "device",
        device_id: sessionDevice?.id ?? null,
        site_code:
          sessionDevice?.site_code ?? employeeDefaults.assigned_site_id ?? null,
      };
      if (schedulePayload) {
        Object.assign(rowPayload, schedulePayload);
      }

      const { data: upserted, error: upsertError } = await admin
        .from("attendance_register")
        .upsert(rowPayload, { onConflict: "tenant_id,staff_id,date" })
        .select("id")
        .single();

      if (upsertError || !upserted?.id) {
        await reportProcessingFailure(
          admin,
          tenantId,
          session.punchIds,
          upsertError?.message ?? "Attendance row was not saved.",
        );
        await markProcessingError(admin, tenantId, session.punchIds);
        continue;
      }

      await markSessionPunches(
        admin,
        tenantId,
        punchIds,
        kept,
        processNote,
        upserted.id,
      );
    }
    } catch (staffError) {
      const punchIds = staffPunches.map((punch) => punch.id);
      await reportProcessingFailure(admin, tenantId, punchIds, staffError);
      await markProcessingError(admin, tenantId, punchIds);
    }
  }
  } catch (error) {
    const punchIds = punchRows.map((punch) => punch.id);
    await reportProcessingFailure(admin, tenantId, punchIds, error);
    await markProcessingError(admin, tenantId, punchIds);
  }
  await syncOpenSessionReviewNotes(admin, tenantId, nowMs);
}

async function loadOpenSessionAnchors(
  admin: SupabaseClient,
  tenantId: string,
  staffIds: string[],
  nowMs: number,
): Promise<OpenSessionAnchor[]> {
  if (!staffIds.length) {
    return [];
  }
  const { data, error } = await admin
    .from("attendance_register")
    .select("id, date, staff_id, clock_in")
    .eq("tenant_id", tenantId)
    .eq("source", "device")
    .is("clock_out", null)
    .in("staff_id", staffIds);
  if (error || !data?.length) {
    return [];
  }

  const openRows = data.filter((row) =>
    registerSessionWindowOpen(
      String(row.date ?? ""),
      row.clock_in == null ? null : String(row.clock_in),
      nowMs,
    ),
  );
  if (!openRows.length) {
    return [];
  }

  const rowIds = openRows.map((row) => String(row.id));
  const { data: linked } = await admin
    .from("biometric_punches")
    .select("id, attendance_register_id")
    .eq("tenant_id", tenantId)
    .in("attendance_register_id", rowIds);
  const punchIdsByRow = new Map<string, string[]>();
  for (const punch of linked ?? []) {
    const rowId = String(punch.attendance_register_id ?? "");
    const list = punchIdsByRow.get(rowId) ?? [];
    list.push(String(punch.id));
    punchIdsByRow.set(rowId, list);
  }

  const anchors: OpenSessionAnchor[] = [];
  for (const row of openRows) {
    const clockInIso = registerSessionStartIso(
      String(row.date ?? ""),
      row.clock_in == null ? null : String(row.clock_in),
    );
    if (!clockInIso || !row.staff_id) {
      continue;
    }
    anchors.push({
      staffId: String(row.staff_id),
      sessionDate: String(row.date ?? "").slice(0, 10),
      clockInIso,
      punchIds: punchIdsByRow.get(String(row.id)) ?? [],
    });
  }
  return anchors;
}

async function syncOpenSessionReviewNotes(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
): Promise<void> {
  const { data, error } = await admin
    .from("attendance_register")
    .select("id, date, clock_in, clock_out, source, staff_id")
    .eq("tenant_id", tenantId)
    .eq("source", "device")
    .is("clock_out", null);
  if (error || !data) {
    return;
  }

  // Exempt staff are never flagged for a missing clock-out.
  const exemptStaff = new Set<string>();
  try {
    const openStaffIds = [
      ...new Set(
        data
          .map((row) => (row.staff_id ? String(row.staff_id) : ""))
          .filter(Boolean),
      ),
    ];
    const modes = await loadAttendanceModesForStaff(admin, tenantId, openStaffIds);
    for (const [staffId, mode] of modes) {
      if (mode === "exempt") {
        exemptStaff.add(staffId);
      }
    }
  } catch {
    // Keep the standard behaviour when the mode lookup fails.
  }

  for (const row of data) {
    if (row.staff_id && exemptStaff.has(String(row.staff_id))) {
      continue;
    }
    const startIso = registerSessionStartIso(
      String(row.date ?? ""),
      row.clock_in == null ? null : String(row.clock_in),
    );
    if (!startIso) {
      continue;
    }
    const closed = sessionWindowHasClosed(startIso, nowMs);
    const { data: linked } = await admin
      .from("biometric_punches")
      .select("id, process_note")
      .eq("tenant_id", tenantId)
      .eq("attendance_register_id", row.id);
    const flagIds: string[] = [];
    const clearIds: string[] = [];
    for (const punch of linked ?? []) {
      const note = String(punch.process_note ?? "");
      if (note.endsWith(":dismissed")) {
        continue;
      }
      if (
        closed &&
        note !== "missing_clock_out" &&
        (note === "" || note === "future_time")
      ) {
        flagIds.push(String(punch.id));
      }
      if (!closed && note === "missing_clock_out") {
        clearIds.push(String(punch.id));
      }
    }
    if (flagIds.length > 0) {
      await admin
        .from("biometric_punches")
        .update({ process_note: "missing_clock_out" })
        .eq("tenant_id", tenantId)
        .in("id", flagIds);
    }
    if (clearIds.length > 0) {
      await admin
        .from("biometric_punches")
        .update({ process_note: null })
        .eq("tenant_id", tenantId)
        .in("id", clearIds);
    }
  }
}

async function markSessionPunches(
  admin: SupabaseClient,
  tenantId: string,
  punchIds: string[],
  kept: PunchRow[],
  sessionNote: string | null,
  attendanceRegisterId: string,
) {
  if (sessionNote) {
    await markPunchesProcessed(admin, tenantId, punchIds, {
      process_note: sessionNote,
      attendance_register_id: attendanceRegisterId,
    });
    return;
  }
  const driftIds: string[] = [];
  const clearIds: string[] = [];
  for (const id of punchIds) {
    const note = kept.find((punch) => punch.id === id)?.process_note;
    if (isScannerClockDriftNote(note)) {
      driftIds.push(id);
    } else {
      clearIds.push(id);
    }
  }
  await markPunchesProcessed(admin, tenantId, clearIds, {
    process_note: null,
    attendance_register_id: attendanceRegisterId,
  });
  for (const id of driftIds) {
    const note = kept.find((punch) => punch.id === id)?.process_note ?? null;
    await markPunchesProcessed(admin, tenantId, [id], {
      process_note: note,
      attendance_register_id: attendanceRegisterId,
    });
  }
}

async function markPunchesProcessed(
  admin: SupabaseClient,
  tenantId: string,
  punchIds: string[],
  update: {
    process_note: string | null;
    attendance_register_id?: string | null;
  },
) {
  if (!punchIds.length) {
    return;
  }
  await admin
    .from("biometric_punches")
    .update({
      processed_at: new Date().toISOString(),
      process_note: update.process_note,
      attendance_register_id: update.attendance_register_id ?? null,
    })
    .eq("tenant_id", tenantId)
    .in("id", punchIds);
}

async function loadStaffGroupProjects(
  admin: SupabaseClient,
  tenantId: string,
): Promise<StaffGroupProject[]> {
  const { data } = await admin
    .from("projects")
    .select("project_code, project_name, service_contract_id, is_archived")
    .eq("tenant_id", tenantId);
  return (data as StaffGroupProject[] | null) ?? [];
}

async function loadDevicesForPunches(
  admin: SupabaseClient,
  tenantId: string,
  punches: PunchRow[],
  preset: DeviceRow | null,
): Promise<Map<string, DeviceRow>> {
  const map = new Map<string, DeviceRow>();
  if (preset?.id) {
    map.set(preset.id, preset);
  }
  const ids = [
    ...new Set(
      punches
        .map((punch) => punch.device_id)
        .filter((id): id is string => Boolean(id && !map.has(id))),
    ),
  ];
  if (ids.length === 0) {
    return map;
  }
  const { data } = await admin
    .from("attendance_devices")
    .select(
      "id, tenant_id, site_code, timezone, contract_project, company_wide",
    )
    .eq("tenant_id", tenantId)
    .in("id", ids);
  for (const row of (data as DeviceRow[] | null) ?? []) {
    map.set(row.id, row);
  }
  return map;
}
