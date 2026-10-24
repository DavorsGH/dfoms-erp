import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deviceTimezoneOrDefault,
  localDateInZone,
} from "@/lib/adms/timezone-utils";
import { punchTimeIsStillFuture } from "@/lib/adms/punch-eligibility";
import { processBiometricPunchesForTenant } from "@/lib/adms/punch-processor";
import {
  normalizeDevicePin,
  resolveStaffIdForDevicePin,
} from "@/lib/device-pin";
import {
  isHikvisionAuthFailureSubEvent,
  isHikvisionAuthSuccessSubEvent,
} from "@/lib/hikvision/event-codes";
import type { HikvisionDeviceRow } from "@/lib/hikvision/device-lookup";
import { touchHikvisionDeviceSeen } from "@/lib/hikvision/device-lookup";
import { logHikvisionEvent } from "@/lib/hikvision/log-hikvision-event";
import type { HikvisionParsedEvent } from "@/lib/hikvision/parse-event";

export type IngestHikvisionResult =
  | { outcome: "heartbeat" }
  | { outcome: "ignored" }
  | { outcome: "unknown_sub_event"; subEventType: number }
  | { outcome: "inserted"; staffId: string | null }
  | { outcome: "duplicate" }
  | { outcome: "skipped_no_time" };

function isAccessControllerEvent(eventType: string | null): boolean {
  if (!eventType) {
    return false;
  }
  return eventType.trim().toLowerCase() === "accesscontrollerevent";
}

function parsePunchTime(
  dateTime: string | null,
  timeZone: string,
): { punchTimeIso: string; punchLocalDate: string } | null {
  if (!dateTime?.trim()) {
    return null;
  }
  const punchMs = Date.parse(dateTime.trim());
  if (!Number.isFinite(punchMs)) {
    return null;
  }
  const punchTimeIso = new Date(punchMs).toISOString();
  return {
    punchTimeIso,
    punchLocalDate: localDateInZone(punchTimeIso, timeZone),
  };
}

export async function ingestHikvisionEvent(
  admin: SupabaseClient,
  device: HikvisionDeviceRow,
  event: HikvisionParsedEvent,
  options?: {
    nowMs?: number;
    lastIp?: string | null;
  },
): Promise<IngestHikvisionResult> {
  const nowMs = options?.nowMs ?? Date.now();
  await touchHikvisionDeviceSeen(
    admin,
    device,
    options?.lastIp ?? null,
    event.macAddress,
  );

  if (event.isHeartbeat) {
    return { outcome: "heartbeat" };
  }

  if (!isAccessControllerEvent(event.eventType)) {
    return { outcome: "ignored" };
  }

  if (event.majorEventType !== 5) {
    return { outcome: "ignored" };
  }

  const employeeRaw = (event.employeeNo ?? "").trim();
  if (!employeeRaw) {
    return { outcome: "ignored" };
  }

  const devicePin = normalizeDevicePin(employeeRaw);
  if (!devicePin) {
    return { outcome: "ignored" };
  }

  const subEventType = event.subEventType;
  if (subEventType == null || !Number.isFinite(subEventType)) {
    return { outcome: "ignored" };
  }

  if (isHikvisionAuthFailureSubEvent(subEventType)) {
    return { outcome: "ignored" };
  }

  if (!isHikvisionAuthSuccessSubEvent(subEventType)) {
    await logHikvisionEvent({
      eventName: "hikvision_unknown_sub_event",
      status: "warning",
      message: `AccessControllerEvent major 5 subEventType ${subEventType} not in success or failure lists`,
      metadata: {
        tenant_id: device.tenant_id,
        device_id: device.id,
        sub_event_type: subEventType,
        employee_no: employeeRaw,
        serial_no: event.serialNo,
      },
    });
    return { outcome: "unknown_sub_event", subEventType };
  }

  const timeZone = deviceTimezoneOrDefault(device.timezone);
  const converted = parsePunchTime(event.dateTime, timeZone);
  if (!converted) {
    return { outcome: "skipped_no_time" };
  }

  const { data: pinMappings } = await admin
    .from("employee_biometric_ids")
    .select("staff_id, device_pin")
    .eq("tenant_id", device.tenant_id);
  const mappings = (pinMappings ?? []) as {
    staff_id: string;
    device_pin: string;
  }[];

  const staffId = resolveStaffIdForDevicePin(devicePin, mappings);
  const isFuture = punchTimeIsStillFuture(converted.punchTimeIso, nowMs);

  const verifyMode = event.currentVerifyMode?.trim() ?? "";
  const verifyCode = /^\d+$/.test(verifyMode)
    ? Number.parseInt(verifyMode, 10)
    : null;

  const insertRow = {
    tenant_id: device.tenant_id,
    device_id: device.id,
    source: "isapi" as const,
    device_pin: devicePin,
    staff_id: staffId,
    punch_time: converted.punchTimeIso,
    punch_local_date: converted.punchLocalDate,
    status_code: subEventType,
    verify_code: verifyCode,
    work_code: event.attendanceStatus,
    vendor_event_serial: event.serialNo,
    raw_line: event.rawText,
    process_note: isFuture ? "future_time" : null,
  };

  const { error: insertError } = await admin
    .from("biometric_punches")
    .insert(insertRow);

  if (insertError) {
    if (insertError.code === "23505") {
      return { outcome: "duplicate" };
    }
    throw insertError;
  }

  if (staffId) {
    await processBiometricPunchesForTenant(admin, device.tenant_id, {
      staffIds: [staffId],
      device,
      nowMs,
      retryProcessingErrors: true,
    });
  }

  return { outcome: "inserted", staffId };
}
