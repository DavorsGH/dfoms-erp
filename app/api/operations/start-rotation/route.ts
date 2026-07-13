import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserFullName } from "@/utils/current-user";
import {
  buildRotationHistoryInserts,
  normalizeDutyRosterEmployee,
  type DutyRosterProject,
  type RosterConfigRecord,
  type RosterHistoryRecord,
} from "@/app/dashboard/operations/duty-roster-utils";

function formatTodayIsoDate(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function POST() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const generatedBy = (await getCurrentUserFullName()) ?? "System";
  const generatedDate = formatTodayIsoDate();
  const supabase = createAdminClient();

  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: history, error: historyError },
  ] = await Promise.all([
    supabase.from("roster_config").select("*").limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      ),
    supabase
      .from("projects")
      .select("project_code, project_name, required_staff"),
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
  if (historyError) {
    return NextResponse.json({ error: historyError.message }, { status: 500 });
  }

  const config = configRows?.[0] as RosterConfigRecord | undefined;
  if (!config) {
    return NextResponse.json(
      { error: "Roster configuration has not been set up yet." },
      { status: 400 },
    );
  }

  const { inserts, nextCycleStartDate, nextRotationNumber } =
    buildRotationHistoryInserts({
      employees:
        (
          employees as Array<
            Parameters<typeof normalizeDutyRosterEmployee>[0]
          > | null
        )?.map((employee) => normalizeDutyRosterEmployee(employee)) ?? [],
      projects: (projects as DutyRosterProject[] | null) ?? [],
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
