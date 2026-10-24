import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendanceDeviceRow } from "@/lib/adms/device-registry";

export type HikvisionDeviceRow = AttendanceDeviceRow & {
  protocol: string;
  mac_address: string | null;
  push_token_hash: string | null;
  brand: string | null;
};

export async function findIsapiDeviceByPushTokenHash(
  admin: SupabaseClient,
  pushTokenHash: string,
): Promise<HikvisionDeviceRow | null> {
  const hash = pushTokenHash.trim().toLowerCase();
  if (!hash) {
    return null;
  }

  const { data } = await admin
    .from("attendance_devices")
    .select(
      "id, tenant_id, serial_number, status, timezone, site_code, contract_project, company_wide, protocol, mac_address, push_token_hash, brand",
    )
    .eq("push_token_hash", hash)
    .eq("protocol", "isapi")
    .maybeSingle();

  return (data as HikvisionDeviceRow | null) ?? null;
}

export async function touchHikvisionDeviceSeen(
  admin: SupabaseClient,
  device: HikvisionDeviceRow,
  lastIp: string | null,
  macAddress: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    last_ip: lastIp,
  };
  if (macAddress && macAddress.trim()) {
    patch.mac_address = macAddress.trim();
  }

  await admin
    .from("attendance_devices")
    .update(patch)
    .eq("tenant_id", device.tenant_id)
    .eq("id", device.id);
}
