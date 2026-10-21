import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Client } from "pg";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  resolveServerWriteBusinessUnitId,
} from "@/utils/business-unit-access.server";
import { START_ROTATION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { resolveDatabaseUrl } from "@/utils/database-url";
import { commitRotationStart } from "@/lib/rotation-start-commit";
import { getCurrentUserFullName } from "@/utils/current-user";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "@/app/dashboard/administration/projects-utils";
import {
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "@/app/dashboard/operations/duty-roster-utils";
import {
  buildRotationStartFromPlan,
  keepEveryoneNextSites,
  listRotationPlanEmployees,
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

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(START_ROTATION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  const body = (await request.json().catch(() => ({}))) as {
    client_id?: string;
    assignments?: Array<{ employee_id?: string; next_site_code?: string }>;
  };
  const clientId = body.client_id?.trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "Select a customer before starting a rotation." },
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

  if (configError) {
    return NextResponse.json({ error: configError.message }, { status: 500 });
  }
  if (employeesError) {
    return NextResponse.json({ error: employeesError.message }, { status: 500 });
  }
  if (projectsError) {
    return NextResponse.json({ error: projectsError.message }, { status: 500 });
  }
  if (sitesError) {
    return NextResponse.json({ error: sitesError.message }, { status: 500 });
  }
  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const config = (configRows?.[0] as RosterConfigRecord | undefined) ?? null;
  if (!config) {
    return NextResponse.json(
      {
        error:
          "Roster configuration has not been set up for this customer yet.",
      },
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

  let metadataBusinessUnitId = configAccess.businessUnitId;
  if (!metadataBusinessUnitId) {
    const writeBu = await resolveServerWriteBusinessUnitId({
      supabase: sessionClient,
      tenantId,
      authUid: user.id,
    });
    if (!writeBu.ok) {
      return NextResponse.json(
        { error: writeBu.error },
        { status: writeBu.status },
      );
    }
    metadataBusinessUnitId = writeBu.businessUnitId;
  }
  if (!metadataBusinessUnitId) {
    return NextResponse.json(
      { error: "A business unit is required to start a rotation." },
      { status: 400 },
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
      employees as Array<
        Parameters<typeof normalizeDutyRosterEmployee>[0]
      > | null
    )?.map((employee) => normalizeDutyRosterEmployee(employee)) ?? [];
  const rosterHistory = (history as RosterHistoryRecord[] | null) ?? [];
  const planEmployees = listRotationPlanEmployees({
    clientId,
    employees: normalizedEmployees,
    projects: normalizedProjects,
    sites: normalizedSites,
  });
  const allowedSiteCodes = new Set(
    listRotationPlanSites(clientId, normalizedSites, normalizedProjects).map(
      (site) => site.siteCode,
    ),
  );
  const eligible = new Map(
    planEmployees.map((employee) => [employee.employeeId, employee]),
  );
  const nextSiteByEmployee: Record<string, string> = {};

  if (!Array.isArray(body.assignments)) {
    Object.assign(nextSiteByEmployee, keepEveryoneNextSites(planEmployees));
  } else {
    for (const assignment of body.assignments) {
      const employeeId = assignment.employee_id?.trim() ?? "";
      const nextSite = assignment.next_site_code?.trim() ?? "";
      const employee = eligible.get(employeeId);
      if (!employee) {
        return NextResponse.json(
          { error: "One of the planned employees is not on this customer's roster." },
          { status: 400 },
        );
      }
      if (nextSite && !allowedSiteCodes.has(nextSite)) {
        return NextResponse.json(
          { error: "A planned site is not part of this contract." },
          { status: 400 },
        );
      }
      if (!nextSite && employee.currentSiteCode) {
        return NextResponse.json(
          { error: "Choose a next site for every employee who already has one." },
          { status: 400 },
        );
      }
      nextSiteByEmployee[employeeId] = nextSite;
    }
    for (const employee of planEmployees) {
      if (!(employee.employeeId in nextSiteByEmployee)) {
        nextSiteByEmployee[employee.employeeId] = employee.currentSiteCode ?? "";
      }
    }
  }

  const plan = buildRotationStartFromPlan({
    clientId,
    employees: normalizedEmployees,
    projects: normalizedProjects,
    sites: normalizedSites,
    history: rosterHistory,
    config,
    nextSiteByEmployee,
    generatedBy,
    generatedDate,
  });

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        error:
          "Rotation start needs a database transaction, and no database URL is configured.",
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
  const startedAt = new Date().toISOString();

  try {
    await pgClient.connect();
    await commitRotationStart({
      client: pgClient,
      tenantId,
      clientId,
      configId: config.id,
      plan,
      startedByName: generatedBy,
      startedByAuthUid: user.id,
      startedAt,
      businessUnitId: metadataBusinessUnitId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start rotation.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await pgClient.end().catch(() => undefined);
  }

  return NextResponse.json({
    message:
      plan.updates.length > 0
        ? `Rotation ${plan.nextRotationNumber} started with ${plan.updates.length} assignment change(s).`
        : `Rotation ${plan.nextRotationNumber} started. No assignment changes were recorded.`,
    insertedCount: plan.history.length,
    nextCycleStartDate: plan.nextCycleStartDate,
    nextRotationNumber: plan.nextRotationNumber,
  });
}
