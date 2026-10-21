import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type AttendanceDeviceRow = {
  id: string;
  tenant_id: string;
  serial_number: string;
  status: string;
  timezone: string | null;
  site_code: string | null;
  contract_project: string | null;
  company_wide: boolean;
};

export async function findDeviceBySerial(
  admin: SupabaseClient,
  serialNumber: string,
): Promise<AttendanceDeviceRow | null> {
  const sn = serialNumber.trim();
  if (!sn) {
    return null;
  }
  const { data } = await admin
    .from("attendance_devices")
    .select(
      "id, tenant_id, serial_number, status, timezone, site_code, contract_project, company_wide",
    )
    .eq("serial_number", sn)
    .maybeSingle();
  return (data as AttendanceDeviceRow | null) ?? null;
}

export async function recordUnclaimedSerial(
  admin: SupabaseClient,
  serialNumber: string,
  lastIp: string | null,
): Promise<void> {
  const sn = serialNumber.trim();
  if (!sn) {
    return;
  }

  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("attendance_unclaimed_devices")
    .select("serial_number, hit_count")
    .eq("serial_number", sn)
    .maybeSingle();

  if (existing) {
    await admin
      .from("attendance_unclaimed_devices")
      .update({
        last_seen_at: now,
        last_ip: lastIp,
        hit_count: (existing.hit_count ?? 0) + 1,
      })
      .eq("serial_number", sn);
    return;
  }

  await admin.from("attendance_unclaimed_devices").insert({
    serial_number: sn,
    first_seen_at: now,
    last_seen_at: now,
    last_ip: lastIp,
    hit_count: 1,
  });
}

export async function touchDeviceSeen(
  admin: SupabaseClient,
  device: AttendanceDeviceRow,
  lastIp: string | null,
  firmwareInfo?: string | null,
): Promise<void> {
  await admin
    .from("attendance_devices")
    .update({
      last_seen_at: new Date().toISOString(),
      last_ip: lastIp,
      ...(firmwareInfo != null ? { firmware_info: firmwareInfo } : {}),
    })
    .eq("tenant_id", device.tenant_id)
    .eq("id", device.id);
}
