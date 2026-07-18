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
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "../duty-roster-utils";
import {
  ROSTER_CONFIG_SELECT,
  type RosterConfigRecord,
} from "../roster-config-utils";
import { SITE_ASSIGNMENT_SELECT } from "../sites-utils";
import {
  attachDutyRosterProjectRefs,
  fetchDutyRosterEmployeeDisplay,
} from "@/utils/duty-roster-employees";

export default async function DutyRosterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: clients, error: clientsError },
    { data: configRows, error: configError },
    employeesResult,
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: history, error: historyError },
    preparedByName,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase.from("roster_config").select(ROSTER_CONFIG_SELECT),
    fetchDutyRosterEmployeeDisplay(supabase),
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

  const normalizedProjects =
    (projects as DutyRosterProject[] | null)?.map((project) =>
      normalizeProjectEntry(project),
    ) ?? [];

  const fetchError =
    clientsError?.message ??
    configError?.message ??
    employeesResult.error ??
    projectsError?.message ??
    sitesError?.message ??
    historyError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Duty Roster">
      <DutyRoster
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialConfigs={(configRows as RosterConfigRecord[] | null) ?? []}
        initialEmployees={attachDutyRosterProjectRefs(
          employeesResult.employees,
          normalizedProjects,
        )}
        initialProjects={normalizedProjects}
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
