import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserEmployeeId } from "@/utils/dashboard-auth";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "../../administration/projects-utils";
import { getRosterConfigForClient } from "../../operations/roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "../../operations/sites-utils";
import MyRoster, {
  type MyRosterAssignment,
  type MyRosterHistoryRow,
} from "../my-roster";
import SelfServiceShell from "../self-service-shell";

export default async function SelfServiceRosterPage() {
  const employeeId = await getCurrentUserEmployeeId();

  if (!employeeId) {
    return (
      <SelfServiceShell sectionTitle="My Roster">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to an employee record.
        </div>
      </SelfServiceShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: employee, error: employeeError },
    { data: historyRows, error: historyError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: rosterConfigs, error: configError },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, shift, contract_project, assigned_site_id, project_ref:projects!contract_project(project_code, project_name)",
      )
      .eq("employee_id", employeeId)
      .maybeSingle(),
    supabase
      .from("roster_history")
      .select("effective_date, roster_number, shift, new_location, generated_by")
      .eq("employee_id", employeeId)
      .order("effective_date", { ascending: false }),
    supabase.from("projects").select(PROJECT_SELECT),
    supabase.from("sites").select(SITE_ASSIGNMENT_SELECT),
    supabase.from("roster_config").select(
      "id, client_id, cycle_start_date, cycle_length_days, morning_time, afternoon_time, supervisor_time",
    ),
  ]);

  const fetchError =
    employeeError?.message ??
    historyError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    configError?.message ??
    null;

  const projectLookup = new Map(
    ((projects ?? []).map((project) => normalizeProjectEntry(project)) ?? []).map(
      (project) => [project.project_code, project.project_name],
    ),
  );

  let assignment: MyRosterAssignment | null = null;

  if (employee) {
    const projectRef = Array.isArray(employee.project_ref)
      ? employee.project_ref[0]
      : employee.project_ref;
    const contractProjectLabel = projectRef?.project_name
      ? `${projectRef.project_code} — ${projectRef.project_name}`
      : employee.contract_project
        ? `${employee.contract_project}${
            projectLookup.has(employee.contract_project)
              ? ` — ${projectLookup.get(employee.contract_project)}`
              : ""
          }`
        : "—";

    const assignedSite = (sites ?? []).find(
      (site) => site.site_code === employee.assigned_site_id,
    );
    const assignedSiteLabel = assignedSite
      ? `${assignedSite.site_code} — ${assignedSite.site_name}`
      : employee.assigned_site_id ?? "—";

    const rosterConfig = assignedSite?.client_id
      ? getRosterConfigForClient(rosterConfigs ?? [], assignedSite.client_id)
      : null;
    const cycleLabel = rosterConfig
      ? `${rosterConfig.cycle_length_days}-day cycle from ${rosterConfig.cycle_start_date}`
      : null;

    assignment = {
      staffId: employee.staff_id,
      fullName: employee.full_name,
      shift: employee.shift,
      contractProjectLabel,
      assignedSiteLabel,
      cycleLabel,
    };
  }

  const history: MyRosterHistoryRow[] = (historyRows ?? []).map((row) => ({
    effectiveDate: row.effective_date,
    rosterNumber: row.roster_number,
    shift: row.shift,
    locationLabel:
      projectLookup.get(row.new_location ?? "") ??
      row.new_location ??
      "—",
    preparedBy: row.generated_by,
  }));

  return (
    <SelfServiceShell sectionTitle="My Roster">
      <MyRoster assignment={assignment} history={history} fetchError={fetchError} />
    </SelfServiceShell>
  );
}
