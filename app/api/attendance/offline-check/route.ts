import { NextResponse } from "next/server";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import {
  normalizeTenantDeviceSettings,
  TENANT_DEVICE_SETTINGS_DEFAULTS,
} from "@/utils/tenant-device-settings";
import {
  hasRecentDeviceContact,
  isWithinWorkingHours,
} from "@/lib/attendance-requests/rules";
import {
  isAttendanceHubRole,
  requireSessionActor,
} from "@/lib/attendance-requests/session";

export async function POST() {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }
  if (!isAttendanceHubRole(session.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { admin, actor } = session;
  const { count: deviceCount, error: countError } = await admin
    .from("attendance_devices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", actor.tenantId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if (!deviceCount) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const [settingsResult, devicesResult, accountsResult] = await Promise.all([
    admin
      .from("tenant_device_settings")
      .select(
        "offline_alert_minutes, working_hours_start, working_hours_end",
      )
      .eq("tenant_id", actor.tenantId)
      .maybeSingle(),
    admin
      .from("attendance_devices")
      .select("id, device_name, serial_number, site_code, status, last_seen_at")
      .eq("tenant_id", actor.tenantId)
      .neq("status", "disabled"),
    admin
      .from("user_accounts")
      .select("auth_uid, is_active, role")
      .eq("tenant_id", actor.tenantId)
      .in("role", ["super_admin", "director", "hr", "finance_admin"]),
  ]);

  const error =
    settingsResult.error ?? devicesResult.error ?? accountsResult.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings = normalizeTenantDeviceSettings(
    settingsResult.data ?? TENANT_DEVICE_SETTINGS_DEFAULTS,
  );
  if (
    !isWithinWorkingHours(
      settings.working_hours_start,
      settings.working_hours_end,
    )
  ) {
    return NextResponse.json({ ok: true, notified: 0 });
  }

  const stale = (devicesResult.data ?? []).filter(
    (device) =>
      !hasRecentDeviceContact(device.last_seen_at, settings.offline_alert_minutes),
  );
  const recipients = (accountsResult.data ?? [])
    .filter((row) => row.is_active !== false && row.auth_uid)
    .map((row) => row.auth_uid as string);

  let notified = 0;
  for (const device of stale) {
    const actionUrl = `/dashboard/devices?offlineDevice=${device.id}`;
    const { data: existing, error: existingError } = await admin
      .from("employee_notifications")
      .select("created_at")
      .eq("tenant_id", actor.tenantId)
      .eq("action_url", actionUrl)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existingError) {
      continue;
    }

    const lastNotice = existing?.[0]?.created_at
      ? Date.parse(existing[0].created_at)
      : Number.NaN;
    const lastSeen = device.last_seen_at
      ? Date.parse(device.last_seen_at)
      : Number.NaN;
    const alreadyNotified =
      Number.isFinite(lastNotice) &&
      (!Number.isFinite(lastSeen) || lastNotice > lastSeen);
    if (alreadyNotified || recipients.length === 0) {
      continue;
    }

    const label =
      device.device_name?.trim() || device.serial_number || "Attendance scanner";
    const site = device.site_code ? ` at ${device.site_code}` : "";
    const sent = await insertEmployeeInAppNotifications({
      context: "attendance-device-offline",
      rows: recipients.map((recipient_user_id) => ({
        tenant_id: actor.tenantId,
        recipient_user_id,
        title: "Attendance scanner offline",
        body: `${label}${site} has not checked in for more than ${settings.offline_alert_minutes} minutes.`,
        action_url: actionUrl,
      })),
    });
    if (sent) {
      notified += 1;
    }
  }

  return NextResponse.json({ ok: true, notified });
}
