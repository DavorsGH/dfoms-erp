import { NextResponse } from "next/server";
import { otherContractReviewText } from "@/lib/adms/punch-contract";
import { processBiometricPunchesForTenant } from "@/lib/adms/punch-processor";
import { unprocessedPunchCutoff } from "@/lib/adms/punch-eligibility";
import {
  registerSessionWindowOpen,
  SESSION_WINDOW_MS,
} from "@/lib/adms/punch-session-utils";
import {
  reviewNoteCode,
  reviewNoteLabel,
} from "@/lib/adms/review-note-text";
import {
  isAttendanceHubRole,
  requireSessionActor,
} from "@/lib/attendance-requests/session";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  fetchScopedStaffIds,
  filterRowsByStaffIdScope,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

const REVIEW_NOTES = [
  "missing_clock_out",
  "future_time",
  "manual_row_exists",
  "other_contract",
  "processing_error",
];

export async function GET() {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }
  if (!isAttendanceHubRole(session.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { admin, actor } = session;
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
    admin,
    actor.tenantId,
    buScope,
  );
  if (staffScopeError) {
    return NextResponse.json({ error: staffScopeError }, { status: 500 });
  }

  const nowMs = Date.now();
  await processBiometricPunchesForTenant(admin, actor.tenantId, {
    dueFutureOnly: true,
    nowMs,
  });
  const stuckBefore = unprocessedPunchCutoff();
  const openSince = new Date(nowMs - SESSION_WINDOW_MS).toISOString().slice(0, 10);
  const [notedResult, unmappedResult, stuckResult, openResult, employeesResult] =
    await Promise.all([
      admin
        .from("biometric_punches")
        .select(
          "id, staff_id, device_pin, punch_time, process_note, processed_at, device_id, attendance_register_id",
        )
        .eq("tenant_id", actor.tenantId)
        .in("process_note", REVIEW_NOTES)
        .order("punch_time", { ascending: false })
        .limit(200),
      admin
        .from("biometric_punches")
        .select(
          "id, staff_id, device_pin, punch_time, process_note, processed_at, device_id, attendance_register_id",
        )
        .eq("tenant_id", actor.tenantId)
        .is("staff_id", null)
        .order("punch_time", { ascending: false })
        .limit(200),
      admin
        .from("biometric_punches")
        .select(
          "id, staff_id, device_pin, punch_time, process_note, processed_at, device_id, attendance_register_id",
        )
        .eq("tenant_id", actor.tenantId)
        .is("processed_at", null)
        .not("staff_id", "is", null)
        .lt("punch_time", stuckBefore)
        .order("punch_time", { ascending: false })
        .limit(200),
      admin
        .from("attendance_register")
        .select("id, staff_id, date, clock_in, clock_out, source, site_code, device_id")
        .eq("tenant_id", actor.tenantId)
        .eq("source", "device")
        .is("clock_out", null)
        .gte("date", openSince)
        .order("date", { ascending: false })
        .limit(200),
      applyBusinessUnitScope(
        admin
          .from("employees")
          .select("staff_id, full_name, employment_status, contract_project")
          .eq("tenant_id", actor.tenantId),
        buScope,
      ),
    ]);

  const error =
    notedResult.error ??
    unmappedResult.error ??
    stuckResult.error ??
    openResult.error ??
    employeesResult.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const punches = new Map<string, Record<string, unknown>>();
  for (const row of filterRowsByStaffIdScope(notedResult.data ?? [], staffIds)) {
    punches.set(row.id, row);
  }
  for (const row of filterRowsByStaffIdScope(unmappedResult.data ?? [], staffIds)) {
    const note = String(row.process_note ?? "");
    if (note.endsWith(":dismissed")) {
      continue;
    }
    punches.set(row.id, row);
  }
  for (const row of filterRowsByStaffIdScope(stuckResult.data ?? [], staffIds)) {
    const note = String(row.process_note ?? "");
    if (note === "future_time" || note.endsWith(":dismissed")) {
      continue;
    }
    punches.set(row.id, row);
  }

  const registerIds = [
    ...new Set(
      [...punches.values()]
        .map((row) => row.attendance_register_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  let registersById = new Map<string, { clock_in: string | null }>();
  if (registerIds.length > 0) {
    const { data: linked, error: linkedError } = await admin
      .from("attendance_register")
      .select("id, clock_in")
      .eq("tenant_id", actor.tenantId)
      .in("id", registerIds);
    if (linkedError) {
      return NextResponse.json({ error: linkedError.message }, { status: 500 });
    }
    registersById = new Map(
      (linked ?? []).map((row) => [row.id as string, { clock_in: row.clock_in }]),
    );
  }

  const names = new Map(
    (employeesResult.data ?? []).map((row) => [
      row.staff_id as string,
      row.full_name as string,
    ]),
  );
  const contracts = new Map(
    (employeesResult.data ?? []).map((row) => [
      row.staff_id as string,
      (row.contract_project as string | null) ?? null,
    ]),
  );
  const deviceIds = [
    ...new Set(
      [...punches.values()]
        .map((row) => row.device_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const deviceLabels = new Map<string, string>();
  if (deviceIds.length > 0) {
    const { data: devices, error: deviceError } = await admin
      .from("attendance_devices")
      .select("id, device_name, serial_number")
      .eq("tenant_id", actor.tenantId)
      .in("id", deviceIds);
    if (deviceError) {
      return NextResponse.json({ error: deviceError.message }, { status: 500 });
    }
    for (const device of devices ?? []) {
      deviceLabels.set(
        device.id as string,
        device.device_name?.trim() || device.serial_number || "unknown",
      );
    }
  }

  const employees = (employeesResult.data ?? [])
    .filter((row) => {
      const status = String(row.employment_status ?? "active").toLowerCase();
      return status === "active";
    })
    .map((row) => ({
      staff_id: row.staff_id as string,
      full_name: row.full_name as string,
    }))
    .sort((left, right) => left.full_name.localeCompare(right.full_name));

  return NextResponse.json({
    punches: [...punches.values()].map((row) => {
      const staffId = row.staff_id ? String(row.staff_id) : null;
      const employeeContract = staffId ? (contracts.get(staffId) ?? null) : null;
      const deviceLabel = row.device_id
        ? (deviceLabels.get(String(row.device_id)) ?? "unknown")
        : "unknown";
      return {
        ...row,
        employee_name: staffId ? (names.get(staffId) ?? null) : null,
        employee_contract: employeeContract,
        register_clock_in: row.attendance_register_id
          ? (registersById.get(String(row.attendance_register_id))?.clock_in ?? null)
          : null,
        review_text: reviewNoteLabel({
          processNote: row.process_note == null ? null : String(row.process_note),
          staffId,
          otherContractText:
            row.process_note === "other_contract"
              ? otherContractReviewText({ deviceLabel, employeeContract })
              : null,
        }),
        review_code: reviewNoteCode({
          processNote: row.process_note == null ? null : String(row.process_note),
          staffId,
        }),
      };
    }),
    openRows: filterRowsByStaffIdScope(openResult.data ?? [], staffIds)
      .filter((row) =>
        registerSessionWindowOpen(
          String(row.date ?? ""),
          row.clock_in == null ? null : String(row.clock_in),
          nowMs,
        ),
      )
      .map((row) => ({
        ...row,
        employee_name: names.get(row.staff_id as string) ?? null,
      })),
    employees,
  });
}
