import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchScopedActiveEmployees } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import type { HrEmployee } from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import IncidentRegister from "../incident-register";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
import {
  INCIDENT_REGISTER_SELECT,
  type IncidentRegisterEntry,
} from "../incident-register-utils";
import type { SiteEntry } from "../sites-utils";

export default async function IncidentRegisterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: entries, error: entriesError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    scopedEmployees,
  ] = await Promise.all([
    supabase
      .from("incident_register")
      .select(INCIDENT_REGISTER_SELECT)
      .order("date", { ascending: false }),
    supabase
      .from("projects")
      .select(
        "project_code, project_name, service_contract_id, contract_type, is_archived",
      )
      .order("project_name", { ascending: true }),
    supabase
      .from("sites")
      .select(
        "site_code, site_name, client_id, project:projects!sites_project_id_fkey(project_code)",
      )
      .order("site_name", { ascending: true }),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({
          employees: [] as HrEmployee[],
          error: "Unable to resolve your workspace.",
        }),
  ]);

  const fetchError =
    scopedEmployees.error ??
    entriesError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Incident Register">
      <IncidentRegister
        initialEntries={(entries as IncidentRegisterEntry[] | null) ?? []}
        initialProjects={(projects as RosterContractProject[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
