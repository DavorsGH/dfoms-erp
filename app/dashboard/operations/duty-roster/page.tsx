import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserFullName } from "@/utils/current-user";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canStartRotation } from "@/utils/rbac-access";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "../../administration/projects-utils";
import { CLIENT_SELECT, type ClientEntry } from "../clients-utils";
import OperationsShell from "../operations-shell";
import DutyRoster from "../duty-roster";
import {
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
  type DutyRosterEmployee,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "../duty-roster-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "../roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "../sites-utils";

export default async function DutyRosterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: clients, error: clientsError },
    { data: configRows, error: configError },
    { data: employees, error: employeesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
    preparedByName,
  ] = await Promise.all([
    supabase.from("clients").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status, project_ref:projects!contract_project(project_code, project_name)",
      )
      .order("staff_id", { ascending: true }),
    supabase
      .from("projects")
      .select(PROJECT_SELECT)
      .order("project_name", { ascending: true }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
    supabase
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false }),
    getCurrentUserFullName(),
  ]);

  const fetchError =
    clientsError?.message ??
    configError?.message ??
    employeesError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    historyError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Duty Roster">
      <DutyRoster
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialConfigs={(configRows as RosterConfigRecord[] | null) ?? []}
        initialEmployees={
          (employees as DutyRosterEmployee[] | null)?.map((employee) =>
            normalizeDutyRosterEmployee(employee),
          ) ?? []
        }
        initialProjects={
          (projects as DutyRosterProject[] | null)?.map((project) =>
            normalizeProjectEntry(project),
          ) ?? []
        }
        initialSites={
          (sites as unknown as DutyRosterSite[] | null)?.map((site) =>
            normalizeDutyRosterSite(site),
          ) ?? []
        }
        initialHistory={(history as RosterHistoryRecord[] | null) ?? []}
        fetchError={fetchError}
        preparedByDefault={preparedByName ?? ""}
        canStartRotation={canStartRotation(
          (await getCurrentUserRole()) as AppRole | null,
        )}
      />
    </OperationsShell>
  );
}
