import type { SupabaseClient } from "@supabase/supabase-js";
import {
  devicePinClashMessage,
  findDevicePinClash,
  normalizeDevicePin,
  pinFromStaffId,
  type DevicePinMapping,
} from "@/lib/device-pin";

export type EmployeePinSyncResult = {
  status: "created" | "updated" | "unchanged" | "skipped";
  detail?: string;
};

export async function ensureEmployeeDevicePin(
  supabase: SupabaseClient,
  tenantId: string,
  staffId: string,
): Promise<EmployeePinSyncResult> {
  const pin = pinFromStaffId(staffId);
  if (!pin) {
    return {
      status: "skipped",
      detail: `${staffId} has no digits, so no attendance PIN was assigned.`,
    };
  }

  const { data, error } = await supabase
    .from("employee_biometric_ids")
    .select("id, staff_id, device_pin")
    .eq("tenant_id", tenantId);
  if (error) {
    return { status: "skipped", detail: error.message };
  }

  const mappings = (data ?? []) as (DevicePinMapping & { id: string })[];
  const clash = findDevicePinClash(pin, staffId, mappings);
  if (clash) {
    return { status: "skipped", detail: devicePinClashMessage(pin, clash) };
  }

  const own = mappings.find((row) => row.staff_id === staffId);
  if (!own) {
    const { error: insertError } = await supabase
      .from("employee_biometric_ids")
      .insert({ tenant_id: tenantId, staff_id: staffId, device_pin: pin });
    if (insertError) {
      return { status: "skipped", detail: insertError.message };
    }
    return { status: "created" };
  }

  if (normalizeDevicePin(own.device_pin) === pin && own.device_pin === pin) {
    return { status: "unchanged" };
  }

  const { error: updateError } = await supabase
    .from("employee_biometric_ids")
    .update({ device_pin: pin })
    .eq("tenant_id", tenantId)
    .eq("id", own.id);
  if (updateError) {
    return { status: "skipped", detail: updateError.message };
  }
  return { status: "updated" };
}
