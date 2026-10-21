import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  PROJECT_SELECT,
  normalizeProjectEntry,
} from "../../administration/projects-utils";
import OperationsShell from "../operations-shell";
import RosterHistory from "../roster-history";
import {
  normalizeDutyRosterSite,
  type DutyRosterProject,
  type DutyRosterSite,
  type RosterHistoryRecord,
} from "../duty-roster-utils";
import { SITE_ASSIGNMENT_SELECT } from "../sites-utils";
import { fetchDutyRosterEmployeeDisplayScoped } from "@/utils/duty-roster-employees";

export default async function RosterHistoryPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: history, error: historyError },
    employeesResult,
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    supabase
      .from("roster_history")
      .select("*")
      .order("effective_date", { ascending: false })
      .order("roster_number", { ascending: false }),
    fetchDutyRosterEmployeeDisplayScoped(supabase, buScope),
    applyBusinessUnitScope(
      supabase
        .from("projects")
        .select(PROJECT_SELECT)
        .eq("is_archived", false),
      buScope,
    ).order("project_name", { ascending: true }),
    supabase
      .from("sites")
      .select(SITE_ASSIGNMENT_SELECT)
      .order("site_name", { ascending: true }),
  ]);

  const fetchError =
    historyError?.message ??
    employeesResult.error ??
    projectsError?.message ??
    sitesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Roster History">
      <RosterHistory
        initialHistory={(history as RosterHistoryRecord[] | null) ?? []}
        employees={employeesResult.employees}
        projects={
          (projects as DutyRosterProject[] | null)?.map((project) =>
            normalizeProjectEntry(project),
          ) ?? []
        }
        sites={
          (sites as unknown as DutyRosterSite[] | null)?.map((site) =>
            normalizeDutyRosterSite(site),
          ) ?? []
        }
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
