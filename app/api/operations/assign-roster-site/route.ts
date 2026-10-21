import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Client } from "pg";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { assertServerRowWriteAccess } from "@/utils/business-unit-access.server";
import { START_ROTATION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { resolveDatabaseUrl } from "@/utils/database-url";
import { commitRosterSiteAssignment } from "@/lib/rotation-start-commit";
import { getCurrentUserFullName } from "@/utils/current-user";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "@/app/dashboard/administration/projects-utils";
import {
  buildClientAssignmentProjectCodes,
  buildDutyRosterCycleSummary,
  filterHistoryForClient,
  getNextRosterNumber,
  listUnassignedRosterEmployees,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "@/app/dashboard/operations/duty-roster-utils";
import {
  buildRosterSiteAssignment,
  listRotationPlanSites,
} from "@/app/dashboard/operations/rotation-plan";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "@/app/dashboard/operations/roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "@/app/dashboard/operations/sites-utils";

function formatTodayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function clampIsoDate(value: string, start: string, end: string): string {
  if (value < start) {
    return start;
  }
  if (value > end) {
    return end;
  }
  return value;
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(START_ROTATION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;
  const body = (await request.json().catch(() => ({}))) as {
    client_id?: string;
    employee_id?: string;
    site_code?: string;
  };
  const clientId = body.client_id?.trim() ?? "";
  const employeeId = body.employee_id?.trim() ?? "";
  const siteCode = body.site_code?.trim() ?? "";

  if (!clientId || !employeeId || !siteCode) {
    return NextResponse.json(
      { error: "Choose a customer, an unassigned employee, and a site." },
      { status: 400 },
    );
  }

  const generatedBy = (await getCurrentUserFullName()) ?? "System";
  const generatedDate = formatTodayIsoDate();
  const cookieStore = await cookies();
  const sessionClient = createClient(cookieStore);
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
  ] = await Promise.all([
    supabase
      .from("roster_config")
      .select(ROSTER_CONFIG_SELECT)
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, assigned_site_id, employment_status, project_ref:projects!employees_contract_project_fkey(project_code, project_name)",
      )
      .eq("tenant_id", tenantId),
    supabase.from("projects").select(PROJECT_SELECT).eq("tenant_id", tenantId),
    supabase.from("sites").select(SITE_ASSIGNMENT_SELECT).eq("tenant_id", tenantId),
    supabase.from("roster_history").select("*").eq("tenant_id", tenantId),
  ]);

  if (configError || employeesError || projectsError || sitesError || historyError) {
    return NextResponse.json(
      {
        error:
          configError?.message ??
          employeesError?.message ??
          projectsError?.message ??
          sitesError?.message ??
          historyError?.message ??
          "Could not load the roster.",
      },
      { status: 500 },
    );
  }

  const config = (configRows?.[0] as RosterConfigRecord | undefined) ?? null;
  if (!config) {
    return NextResponse.json(
      { error: "Roster configuration has not been set up for this customer yet." },
      { status: 400 },
    );
  }

  const configAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId,
    authUid: user.id,
    table: "roster_config",
    rowId: config.id,
  });
  if (!configAccess.ok) {
    return NextResponse.json(
      { error: configAccess.error },
      { status: configAccess.status },
    );
  }

  const employeeAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId,
    authUid: user.id,
    table: "employees",
    rowId: employeeId,
    idColumn: "employee_id",
  });
  if (!employeeAccess.ok) {
    return NextResponse.json(
      { error: employeeAccess.error },
      { status: employeeAccess.status },
    );
  }

  const normalizedProjects =
    ((projects as unknown as DutyRosterProject[] | null) ?? []).map((project) =>
      normalizeProjectEntry(project),
    );
  const normalizedSites =
    ((sites as unknown as DutyRosterSite[] | null) ?? []).map((site) =>
      normalizeDutyRosterSite(site),
    );
  const normalizedEmployees =
    (
      employees as Array<Parameters<typeof normalizeDutyRosterEmployee>[0]> | null
    )?.map((employee) => normalizeDutyRosterEmployee(employee)) ?? [];

  const unassigned = listUnassignedRosterEmployees({
    clientId,
    employees: normalizedEmployees,
    projects: normalizedProjects,
    sites: normalizedSites,
  });
  const employee = unassigned.find((row) => row.employee_id === employeeId);
  if (!employee) {
    return NextResponse.json(
      { error: "That employee is not unassigned on this contract." },
      { status: 400 },
    );
  }

  const allowedSite = listRotationPlanSites(
    clientId,
    normalizedSites,
    normalizedProjects,
  ).some((site) => site.siteCode === siteCode);
  if (!allowedSite) {
    return NextResponse.json(
      { error: "That site is not part of this contract." },
      { status: 400 },
    );
  }

  const rosterHistory = (history as RosterHistoryRecord[] | null) ?? [];
  const clientProjectCodes = buildClientAssignmentProjectCodes(
    normalizedSites,
    normalizedProjects,
    clientId,
  );
  const clientHistory = filterHistoryForClient(
    rosterHistory,
    normalizedEmployees,
    clientProjectCodes,
  );
  const cycle = buildDutyRosterCycleSummary(config, clientHistory);
  const assignment = buildRosterSiteAssignment({
    employee,
    siteCode,
    rosterNumber: getNextRosterNumber(
      clientHistory.map((row) => row.roster_number),
    ),
    rotationNumber: cycle.currentRotationNumber,
    effectiveDate: clampIsoDate(
      generatedDate,
      cycle.cycleStartDate,
      cycle.cycleEndDate,
    ),
    endDate: cycle.cycleEndDate,
    generatedBy,
    generatedDate,
  });

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error:
          "Site assignment needs a database transaction, and no database URL is configured.",
      },
      { status: 500 },
    );
  }

  const pgClient = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  try {
    await pgClient.connect();
    await commitRosterSiteAssignment({
      client: pgClient,
      tenantId,
      employeeId: assignment.employeeId,
      siteCode: assignment.siteCode,
      history: assignment.history,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to assign the site.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pgClient.end().catch(() => undefined);
  }

  return NextResponse.json({
    message: `${employee.full_name} is now assigned to ${siteCode}.`,
    siteCode,
  });
}
