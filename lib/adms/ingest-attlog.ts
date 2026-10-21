import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAttlogBody } from "@/lib/adms/attlog-parser";
import type { AttendanceDeviceRow } from "@/lib/adms/device-registry";
import { resolveReportedPunchTime } from "@/lib/adms/device-clock";
import {
  deviceTimezoneOrDefault,
  localDateTimeToUtcIso,
} from "@/lib/adms/timezone-utils";
import { punchTimeIsStillFuture } from "@/lib/adms/punch-eligibility";
import { processBiometricPunchesForTenant } from "@/lib/adms/punch-processor";
import { resolveStaffIdForDevicePin } from "@/lib/device-pin";

export async function ingestAttlogPost(
  admin: SupabaseClient,
  device: AttendanceDeviceRow,
  body: string,
  options?: {
    nowMs?: number;
    /** Device-local clock from this request only. Never a stored offset. */
    freshDeviceClockLocal?: string | null;
    storedDeviceClockIso?: string | null;
  },
): Promise<{ acceptedLines: number; staffIds: string[] }> {
  const lines = parseAttlogBody(body);
  if (!lines.length) {
    return { acceptedLines: 0, staffIds: [] };
  }

  const timeZone = deviceTimezoneOrDefault(device.timezone);
  const nowMs = options?.nowMs ?? Date.now();
  const freshDeviceClockIso = options?.freshDeviceClockLocal
    ? (localDateTimeToUtcIso(options.freshDeviceClockLocal, timeZone)?.punchTimeIso ??
      null)
    : null;
  const staffIds = new Set<string>();
  const { data: pinMappings } = await admin
    .from("employee_biometric_ids")
    .select("staff_id, device_pin")
    .eq("tenant_id", device.tenant_id);
  const mappings = (pinMappings ?? []) as {
    staff_id: string;
    device_pin: string;
  }[];

  for (const line of lines) {
    const converted = resolveReportedPunchTime({
      localDateTime: line.localDateTime,
      timeZone,
      serverNowMs: nowMs,
      freshDeviceClockIso,
      storedDeviceClockIso: options?.storedDeviceClockIso,
    });
    if (!converted) {
      continue;
    }

    const isFuture = punchTimeIsStillFuture(converted.punchTimeIso, nowMs);

    const staffId = resolveStaffIdForDevicePin(line.devicePin, mappings);
    if (staffId) {
      staffIds.add(staffId);
    }

    const insertRow = {
      tenant_id: device.tenant_id,
      device_id: device.id,
      source: "adms" as const,
      device_pin: line.devicePin,
      staff_id: staffId,
      punch_time: converted.punchTimeIso,
      punch_local_date: converted.punchLocalDate,
      status_code: line.statusCode,
      verify_code: line.verifyCode,
      work_code: line.workCode,
      raw_line: line.rawLine,
      process_note: isFuture ? "future_time" : converted.reviewNote,
    };

    const { error: insertError } = await admin
      .from("biometric_punches")
      .insert(insertRow);
    if (insertError && insertError.code !== "23505") {
      throw insertError;
    }
  }

  if (staffIds.size > 0) {
    await processBiometricPunchesForTenant(admin, device.tenant_id, {
      staffIds: [...staffIds],
      device,
      nowMs,
      retryProcessingErrors: true,
    });
  }

  return { acceptedLines: lines.length, staffIds: [...staffIds] };
}
