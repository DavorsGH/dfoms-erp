import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserFullName } from "@/utils/current-user";
import OperationsShell from "../operations-shell";
import DutyRoster from "../duty-roster";
import {
  buildDutyRosterViewModel,
  normalizeDutyRosterEmployee,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type RosterConfigRecord,
  type RosterHistoryRecord,
} from "../duty-roster-utils";

export default async function DutyRosterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: history, error: historyError },
    preparedByName,
  ] = await Promise.all([
    supabase.from("roster_config").select("*").limit(1),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      )
      .order("staff_id", { ascending: true }),
    supabase
      .from("projects")
      .select("project_code, project_name, required_staff")
      .order("project_name", { ascending: true }),
    supabase
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false }),
    getCurrentUserFullName(),
  ]);

  const fetchError =
    configError?.message ??
    employeesError?.message ??
    projectsError?.message ??
    historyError?.message ??
    null;

  const config = (configRows?.[0] as RosterConfigRecord | undefined) ?? null;
  const viewModel = config
    ? buildDutyRosterViewModel({
        config,
        employees:
          (employees as DutyRosterEmployee[] | null)?.map((employee) =>
            normalizeDutyRosterEmployee(employee),
          ) ?? [],
        projects: (projects as DutyRosterProject[] | null) ?? [],
        history: (history as RosterHistoryRecord[] | null) ?? [],
      })
    : null;

  return (
    <OperationsShell sectionTitle="Duty Roster">
      <DutyRoster
        data={viewModel}
        fetchError={
          fetchError ??
          (config ? null : "Roster configuration has not been set up yet.")
        }
        preparedByDefault={preparedByName ?? ""}
      />
    </OperationsShell>
  );
}
