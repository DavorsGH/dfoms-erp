import { NextResponse } from "next/server";
import { processBiometricPunchesForTenant } from "@/lib/adms/punch-processor";
import {
  canWriteAttendanceDevices,
  requireSessionActor,
} from "@/lib/attendance-requests/session";
import {
  devicePinClashMessage,
  findDevicePinClash,
  normalizeDevicePin,
  resolveStaffIdForDevicePin,
} from "@/lib/device-pin";

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }
  if (!canWriteAttendanceDevices(session.actor.role)) {
    return NextResponse.json(
      { error: "You do not have permission to assign attendance PINs." },
      { status: 403 },
    );
  }

  let body: { device_pin?: string; staff_id?: string };
  try {
    body = (await request.json()) as { device_pin?: string; staff_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const devicePin = normalizeDevicePin(body.device_pin?.trim() ?? "");
  const staffId = body.staff_id?.trim() ?? "";
  if (!devicePin || !staffId) {
    return NextResponse.json(
      { error: "device_pin and staff_id are required." },
      { status: 400 },
    );
  }

  const { admin, actor } = session;
  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("staff_id")
    .eq("tenant_id", actor.tenantId)
    .eq("staff_id", staffId)
    .maybeSingle();

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 });
  }
  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const { data: pinRows, error: pinError } = await admin
    .from("employee_biometric_ids")
    .select("id, staff_id, device_pin")
    .eq("tenant_id", actor.tenantId);
  if (pinError) {
    return NextResponse.json({ error: pinError.message }, { status: 500 });
  }

  const mappings = pinRows ?? [];
  const nameRows =
    mappings.length === 0
      ? []
      : (
          await admin
            .from("employees")
            .select("staff_id, full_name")
            .eq("tenant_id", actor.tenantId)
            .in(
              "staff_id",
              mappings.map((row) => row.staff_id),
            )
        ).data ?? [];
  const nameByStaffId = new Map(
    (nameRows ?? []).map((row) => [row.staff_id as string, row.full_name as string]),
  );
  const clash = findDevicePinClash(
    devicePin,
    staffId,
    mappings.map((row) => ({
      staff_id: row.staff_id,
      device_pin: row.device_pin,
      full_name: nameByStaffId.get(row.staff_id) ?? null,
    })),
  );
  if (clash) {
    return NextResponse.json(
      { error: devicePinClashMessage(devicePin, clash) },
      { status: 409 },
    );
  }

  const staffPin = mappings.find((row) => row.staff_id === staffId) ?? null;
  if (staffPin && normalizeDevicePin(staffPin.device_pin) !== devicePin) {
    const { error } = await admin
      .from("employee_biometric_ids")
      .update({ device_pin: devicePin })
      .eq("tenant_id", actor.tenantId)
      .eq("id", staffPin.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else if (!staffPin) {
    const { error } = await admin.from("employee_biometric_ids").insert({
      tenant_id: actor.tenantId,
      staff_id: staffId,
      device_pin: devicePin,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data: punches, error: punchError } = await admin
    .from("biometric_punches")
    .select("id, device_pin, process_note")
    .eq("tenant_id", actor.tenantId)
    .is("staff_id", null);

  if (punchError) {
    return NextResponse.json({ error: punchError.message }, { status: 500 });
  }

  const ids = (punches ?? [])
    .filter(
      (row) =>
        resolveStaffIdForDevicePin(String(row.device_pin ?? ""), [
          { staff_id: staffId, device_pin: devicePin },
        ]) === staffId &&
        !String(row.process_note ?? "").endsWith(":dismissed"),
    )
    .map((row) => row.id as string);

  if (ids.length > 0) {
    const { error: updateError } = await admin
      .from("biometric_punches")
      .update({ staff_id: staffId, processed_at: null })
      .eq("tenant_id", actor.tenantId)
      .in("id", ids);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
  }

  await processBiometricPunchesForTenant(admin, actor.tenantId, {
    staffIds: [staffId],
    retryProcessingErrors: true,
  });

  return NextResponse.json({ ok: true, reprocessed: ids.length });
}
