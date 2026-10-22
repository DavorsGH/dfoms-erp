import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  insertPendingRequest,
  loadApproverContext,
  loadEmployeeForAttendance,
  notifyAttendanceApprovers,
} from "@/lib/attendance-requests/service";
import {
  isAttendanceHubRole,
  requireSessionActor,
  type SessionActor,
} from "@/lib/attendance-requests/session";
import {
  buildStaffGroups,
  employeeMatchesStaffGroup,
  findStaffGroup,
  projectsShareStaffGroup,
  staffGroupIsSelectable,
  withSiteCounts,
  type StaffGroupProject,
} from "@/lib/attendance-staff-groups";
import {
  OUTAGE_REASONS,
  hasRecentDeviceContact,
  todayInAccra,
  validateClockPair,
  type OutageReason,
} from "@/lib/attendance-requests/rules";
import {
  normalizeTenantDeviceSettings,
  TENANT_DEVICE_SETTINGS_DEFAULTS,
} from "@/utils/tenant-device-settings";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import { fetchScopedStaffIds } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type DeviceRow = {
  id: string;
  site_code: string | null;
  status: string;
  last_seen_at: string | null;
  device_name: string | null;
  contract_project: string | null;
  company_wide: boolean;
};

type ProjectRow = StaffGroupProject & {
  id: string;
};

type SiteRow = {
  site_code: string;
  site_name: string;
  project_id: string | null;
};

async function supervisedSiteCodes(
  admin: SupabaseClient,
  actor: SessionActor,
): Promise<string[] | null> {
  if (isAttendanceHubRole(actor.role)) {
    return null;
  }
  if (actor.role !== "supervisor") {
    return [];
  }
  const { data, error } = await admin
    .from("user_account_supervisor_sites")
    .select("site_code")
    .eq("tenant_id", actor.tenantId)
    .eq("auth_uid", actor.authUid);
  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => String(row.site_code));
}

function devicesForStaffGroup(
  devices: DeviceRow[],
  anchorProjectCode: string,
  projects: StaffGroupProject[],
): DeviceRow[] {
  return devices.filter(
    (device) =>
      device.company_wide ||
      projectsShareStaffGroup(
        device.contract_project,
        anchorProjectCode,
        projects,
      ),
  );
}

function pickOutageDevice(
  devices: DeviceRow[],
  offlineAlertMinutes: number,
): { blocked: true } | { blocked: false; deviceId: string | null } {
  const active = devices.filter((device) => device.status !== "disabled");
  if (
    active.some((device) =>
      hasRecentDeviceContact(device.last_seen_at, offlineAlertMinutes),
    )
  ) {
    return { blocked: true };
  }
  const offlineActive = active.find(
    (device) => !hasRecentDeviceContact(device.last_seen_at, offlineAlertMinutes),
  );
  const disabled = devices.find((device) => device.status === "disabled");
  return { blocked: false, deviceId: offlineActive?.id ?? disabled?.id ?? null };
}

export async function GET() {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  let allowedSites: string[] | null;
  try {
    allowedSites = await supervisedSiteCodes(session.admin, session.actor);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load sites." },
      { status: 500 },
    );
  }

  if (allowedSites && allowedSites.length === 0 && session.actor.role !== "supervisor") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.actor.role !== "supervisor" && !isAttendanceHubRole(session.actor.role)) {
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

  const [sitesResult, employeesResult, devicesResult, projectsResult, settingsResult] =
    await Promise.all([
      admin
        .from("sites")
        .select("site_code, site_name, project_id")
        .eq("tenant_id", actor.tenantId)
        .order("site_name"),
      applyBusinessUnitScope(
        admin
          .from("employees")
          .select("staff_id, full_name, contract_project, employment_status")
          .eq("tenant_id", actor.tenantId),
        buScope,
      ),
      admin
        .from("attendance_devices")
        .select(
          "id, site_code, status, last_seen_at, device_name, contract_project, company_wide",
        )
        .eq("tenant_id", actor.tenantId),
      admin
        .from("projects")
        .select("id, project_code, project_name, service_contract_id, is_archived")
        .eq("tenant_id", actor.tenantId)
        .order("project_name"),
      admin
        .from("tenant_device_settings")
        .select("offline_alert_minutes")
        .eq("tenant_id", actor.tenantId)
        .maybeSingle(),
    ]);

  const firstError =
    sitesResult.error ??
    employeesResult.error ??
    devicesResult.error ??
    projectsResult.error ??
    settingsResult.error;
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const settings = normalizeTenantDeviceSettings(
    settingsResult.data ?? TENANT_DEVICE_SETTINGS_DEFAULTS,
  );
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const projectCodeById = new Map(
    projects.map((project) => [project.id, project.project_code]),
  );
  const siteAllow = allowedSites ? new Set(allowedSites) : null;
  const sites = ((sitesResult.data ?? []) as SiteRow[])
    .filter((site) => !siteAllow || siteAllow.has(site.site_code))
    .map((site) => ({
      site_code: site.site_code,
      site_name: site.site_name,
      project_code: site.project_id
        ? (projectCodeById.get(site.project_id) ?? null)
        : null,
    }));
  const visibleProjectCodes = new Set(
    sites
      .map((site) => site.project_code)
      .filter((code): code is string => Boolean(code)),
  );
  const countedProjects = withSiteCounts(
    projects,
    ((sitesResult.data ?? []) as SiteRow[]).map((site) =>
      site.project_id ? projectCodeById.get(site.project_id) : null,
    ),
  );
  const visibleGroups = buildStaffGroups(countedProjects).filter((group) => {
    if (!staffGroupIsSelectable(group, countedProjects)) {
      return false;
    }
    if (!siteAllow) {
      return true;
    }
    return group.projectCodes.some((code) => visibleProjectCodes.has(code));
  });
  const allowedStaff =
    staffIds === null ? null : new Set(staffIds);
  const employees = (employeesResult.data ?? []).filter((employee) => {
    const status = String(employee.employment_status ?? "active").toLowerCase();
    if (status !== "active") {
      return false;
    }
    if (allowedStaff === null) {
      return true;
    }
    return allowedStaff.has(String(employee.staff_id ?? ""));
  });

  return NextResponse.json({
    projects: countedProjects.map((project) => ({
      project_code: project.project_code,
      project_name: project.project_name,
      service_contract_id: project.service_contract_id ?? null,
      is_archived: project.is_archived === true,
      site_count: project.site_count ?? 0,
    })),
    groups: visibleGroups.map((group) => ({
      key: group.key,
      label: group.label,
      anchor_project_code: group.anchorProjectCode,
      project_codes: group.projectCodes,
      is_office: group.isOffice,
    })),
    sites,
    employees,
    devices: devicesResult.data ?? [],
    offline_alert_minutes: settings.offline_alert_minutes,
  });
}

type OutageBody = {
  staff_group?: string;
  site_code?: string;
  work_date?: string;
  reason?: string;
  entries?: Array<{ staff_id?: string; clock_in?: string; clock_out?: string }>;
};

export async function POST(request: Request) {
  const session = await requireSessionActor();
  if (!session.ok) {
    return session.response;
  }

  if (session.actor.role === "finance_admin") {
    return NextResponse.json(
      { error: "You have read-only access to attendance devices." },
      { status: 403 },
    );
  }
  if (
    !isAttendanceHubRole(session.actor.role) &&
    session.actor.role !== "supervisor"
  ) {
    return NextResponse.json(
      { error: "You do not have permission to record outage attendance." },
      { status: 403 },
    );
  }

  let body: OutageBody;
  try {
    body = (await request.json()) as OutageBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const staffGroup = body.staff_group?.trim() ?? "";
  const siteCode = body.site_code?.trim() ?? "";
  const workDate = body.work_date?.trim() ?? "";
  const reason = body.reason?.trim() ?? "";
  const entries = body.entries ?? [];

  if (!staffGroup || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return NextResponse.json(
      { error: "Staff group and date are required." },
      { status: 400 },
    );
  }
  if (workDate > todayInAccra()) {
    return NextResponse.json(
      { error: "The date cannot be in the future." },
      { status: 400 },
    );
  }
  if (!OUTAGE_REASONS.includes(reason as OutageReason)) {
    return NextResponse.json(
      { error: "Choose a reason: Scanner offline, Power cut, or Scanner broken." },
      { status: 400 },
    );
  }
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "Tick at least one employee who was present." },
      { status: 400 },
    );
  }

  let allowedSites: string[] | null;
  try {
    allowedSites = await supervisedSiteCodes(session.admin, session.actor);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not check sites." },
      { status: 500 },
    );
  }
  const { admin, actor } = session;
  const [devicesResult, projectsResult, sitesResult, settingsResult] =
    await Promise.all([
      admin
        .from("attendance_devices")
        .select(
          "id, site_code, status, last_seen_at, device_name, contract_project, company_wide",
        )
        .eq("tenant_id", actor.tenantId),
      admin
        .from("projects")
        .select("id, project_code, project_name, service_contract_id, is_archived")
        .eq("tenant_id", actor.tenantId),
      admin
        .from("sites")
        .select("site_code, site_name, project_id")
        .eq("tenant_id", actor.tenantId),
      admin
        .from("tenant_device_settings")
        .select("offline_alert_minutes")
        .eq("tenant_id", actor.tenantId)
        .maybeSingle(),
    ]);

  if (
    devicesResult.error ||
    projectsResult.error ||
    sitesResult.error ||
    settingsResult.error
  ) {
    return NextResponse.json(
      {
        error:
          devicesResult.error?.message ??
          projectsResult.error?.message ??
          sitesResult.error?.message ??
          settingsResult.error?.message,
      },
      { status: 500 },
    );
  }

  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const projectCodeById = new Map(
    projects.map((project) => [project.id, project.project_code]),
  );
  const countedProjects = withSiteCounts(
    projects,
    ((sitesResult.data ?? []) as SiteRow[]).map((site) =>
      site.project_id ? projectCodeById.get(site.project_id) : null,
    ),
  );
  const selectedGroup = findStaffGroup(staffGroup, countedProjects);
  if (!selectedGroup) {
    return NextResponse.json(
      { error: "Choose a staff group." },
      { status: 400 },
    );
  }

  const groupSites = ((sitesResult.data ?? []) as SiteRow[]).filter((site) => {
    const code = site.project_id ? projectCodeById.get(site.project_id) : null;
    return code != null && selectedGroup.projectCodes.includes(code);
  });
  if (allowedSites) {
    const supervised = groupSites.some((site) =>
      allowedSites.includes(site.site_code),
    );
    if (!supervised) {
      return NextResponse.json(
        { error: "You can only record outage attendance for sites you supervise." },
        { status: 403 },
      );
    }
  }
  if (
    siteCode &&
    !groupSites.some((site) => site.site_code === siteCode)
  ) {
    return NextResponse.json(
      { error: "That location is not part of the selected staff group." },
      { status: 400 },
    );
  }
  if (siteCode && allowedSites && !allowedSites.includes(siteCode)) {
    return NextResponse.json(
      { error: "You can only record outage attendance for sites you supervise." },
      { status: 403 },
    );
  }

  const settings = normalizeTenantDeviceSettings(settingsResult.data);
  const devicePick = pickOutageDevice(
    devicesForStaffGroup(
      (devicesResult.data ?? []) as DeviceRow[],
      selectedGroup.anchorProjectCode,
      countedProjects,
    ),
    settings.offline_alert_minutes,
  );
  if (devicePick.blocked) {
    return NextResponse.json(
      {
        error:
          "An attendance scanner for this staff group is online. Staff should use the scanner.",
        code: "device_online",
      },
      { status: 409 },
    );
  }

  const createdStaff: string[] = [];
  const errors: Array<{ staff_id: string; error: string }> = [];

  for (const entry of entries) {
    const staffId = entry.staff_id?.trim() ?? "";
    if (!staffId || !entry.clock_in?.trim() || !entry.clock_out?.trim()) {
      errors.push({
        staff_id: staffId || "—",
        error: "Clock-in and clock-out are required.",
      });
      continue;
    }

    const employee = await loadEmployeeForAttendance(admin, actor.tenantId, staffId);
    if (
      !employee ||
      !employeeMatchesStaffGroup(
        employee.contract_project,
        staffGroup,
        countedProjects,
      )
    ) {
      errors.push({
        staff_id: staffId,
        error: "This employee is not in the selected staff group.",
      });
      continue;
    }
    if (
      employee.employment_status &&
      employee.employment_status.toLowerCase() !== "active"
    ) {
      errors.push({ staff_id: staffId, error: "Employee is not active." });
      continue;
    }

    const pair = validateClockPair({
      workDate,
      clockIn: entry.clock_in,
      clockOut: entry.clock_out,
    });
    if ("error" in pair) {
      errors.push({ staff_id: staffId, error: pair.error });
      continue;
    }

    const inserted = await insertPendingRequest(admin, {
      tenant_id: actor.tenantId,
      request_type: "outage",
      staff_id: staffId,
      work_date: workDate,
      clock_in: pair.clockInIso,
      clock_out: pair.clockOutIso,
      location_note: null,
      reason,
      latitude: null,
      longitude: null,
      location_accuracy_m: null,
      device_id: devicePick.deviceId,
      site_code: siteCode || null,
      contract_project: selectedGroup.anchorProjectCode,
      submitted_by: actor.authUid,
      submitted_by_name: actor.fullName,
    });

    if ("error" in inserted) {
      errors.push({ staff_id: staffId, error: inserted.error });
      continue;
    }
    createdStaff.push(staffId);
  }

  if (createdStaff.length > 0) {
    const approver = await loadApproverContext(admin, actor.tenantId);
    await notifyAttendanceApprovers({
      admin,
      tenantId: actor.tenantId,
      approver,
      staffIds: createdStaff,
      title: "Outage attendance to approve",
      body: `${actor.fullName} submitted ${createdStaff.length} outage attendance ${
        createdStaff.length === 1 ? "entry" : "entries"
      } for ${workDate} (${reason}).`,
    });
  }

  return NextResponse.json({
    ok: createdStaff.length > 0,
    created: createdStaff.length,
    errors,
  });
}
