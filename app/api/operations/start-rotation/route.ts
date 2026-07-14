import { NextResponse } from "next/server";
import { requireRoleIn } from "@/utils/admin-auth";
import { START_ROTATION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserFullName } from "@/utils/current-user";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "@/app/dashboard/administration/projects-utils";
import {
  buildRotationHistoryInserts,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "@/app/dashboard/operations/duty-roster-utils";
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
  const auth = await requireRoleIn(START_ROTATION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const body = (await request.json().catch(() => ({}))) as {
    client_id?: string;
  };
  const clientId = body.client_id?.trim();

  if (!clientId) {
    return NextResponse.json(
      { error: "Select a client before starting a rotation." },
      { status: 400 },
    );
  }

  const generatedBy = (await getCurrentUserFullName()) ?? "System";
  const generatedDate = formatTodayIsoDate();
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
      .eq("client_id", clientId)
      .limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      ),
    supabase.from("projects").select(PROJECT_SELECT),
    supabase.from("sites").select(SITE_ASSIGNMENT_SELECT),
    supabase.from("roster_history").select("*"),
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
          "Roster configuration has not been set up for this client yet.",
      },
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

  const { inserts, nextCycleStartDate, nextRotationNumber } =
    buildRotationHistoryInserts({
      clientId,
      employees:
        (
          employees as Array<
            Parameters<typeof normalizeDutyRosterEmployee>[0]
          > | null
        )?.map((employee) => normalizeDutyRosterEmployee(employee)) ?? [],
      projects: normalizedProjects,
      sites: normalizedSites,
      history: (history as RosterHistoryRecord[] | null) ?? [],
      config,
      generatedBy,
      generatedDate,
    });

  if (inserts.length > 0) {
    const { error: insertError } = await supabase
      .from("roster_history")
      .insert(inserts);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { error: updateError } = await supabase
    .from("roster_config")
    .update({ cycle_start_date: nextCycleStartDate })
    .eq("id", config.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    message:
      inserts.length > 0
        ? `Rotation ${nextRotationNumber} started with ${inserts.length} assignment change(s).`
        : `Rotation ${nextRotationNumber} started. No assignment changes were recorded.`,
    insertedCount: inserts.length,
    nextCycleStartDate,
    nextRotationNumber,
  });
}
