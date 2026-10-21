import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  fetchScopedProjectIds,
  filterSitesByScopedProjectIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";
import {
  SITE_ASSIGNMENT_SELECT,
  type SiteEntry,
} from "../../operations/sites-utils";
import Projects from "../projects";
import {
  normalizeProjectEntry,
  PROJECT_SELECT,
  type ProjectEntry,
} from "../projects-utils";
import {
  normalizeServiceContractListRow,
  SERVICE_CONTRACT_LIST_SELECT,
  type ServiceContractListRow,
} from "@/utils/service-contracts-types";

export default async function ProjectsPage() {
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

  const scopedProjects = tenantId
    ? await fetchScopedProjectIds(supabase, tenantId, buScope)
    : { projectIds: [] as string[], error: "Unable to resolve tenant." };

  const projectsQuery = applyBusinessUnitScope(
    supabase.from("projects").select(PROJECT_SELECT),
    buScope,
  ).order("project_name", { ascending: true });
  const sitesQuery = supabase
    .from("sites")
    .select(SITE_ASSIGNMENT_SELECT)
    .order("site_name", { ascending: true });
  const clientsQuery = supabase
    .from("customers")
    .select(CLIENT_SELECT)
    .order("client_name", { ascending: true });
  const employeesQuery = applyBusinessUnitScope(
    supabase.from("employees").select("contract_project").not("contract_project", "is", null),
    buScope,
  );
  const serviceContractsQuery = applyBusinessUnitScope(
    supabase
      .from("service_contracts")
      .select(SERVICE_CONTRACT_LIST_SELECT)
      .order("contract_number", { ascending: true }),
    buScope,
  );

  if (tenantId) {
    projectsQuery.eq("tenant_id", tenantId);
    sitesQuery.eq("tenant_id", tenantId);
    clientsQuery.eq("tenant_id", tenantId);
    employeesQuery.eq("tenant_id", tenantId);
    serviceContractsQuery.eq("tenant_id", tenantId);
  }

  const [
    { data, error },
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
    { data: employees, error: employeesError },
    { data: serviceContracts, error: serviceContractsError },
  ] = await Promise.all([
    projectsQuery,
    sitesQuery,
    clientsQuery,
    employeesQuery,
    serviceContractsQuery,
  ]);

  const employeeCountByProjectCode: Record<string, number> = {};
  for (const row of employees ?? []) {
    const code = row.contract_project as string | null;
    if (!code) continue;
    employeeCountByProjectCode[code] =
      (employeeCountByProjectCode[code] ?? 0) + 1;
  }

  const scopedSites = filterSitesByScopedProjectIds(
    (sites as SiteEntry[] | null) ?? [],
    scopedProjects.projectIds,
  );

  const scopedProjectRows =
    (data as ProjectEntry[] | null)?.map((project) =>
      normalizeProjectEntry(project),
    ) ?? [];
  const clientIds = new Set<string>();
  for (const site of scopedSites) {
    const clientId = String(site.client_id ?? "").trim();
    if (clientId) {
      clientIds.add(clientId);
    }
  }
  for (const contract of (serviceContracts as ServiceContractListRow[] | null) ??
    []) {
    const clientId = String(contract.client_id ?? "").trim();
    if (clientId) {
      clientIds.add(clientId);
    }
  }

  const scopedClients =
    buScope.mode === "all"
      ? ((clients as ClientEntry[] | null) ?? [])
      : ((clients as ClientEntry[] | null) ?? []).filter((client) =>
          clientIds.has(String(client.client_id ?? "").trim()),
        );

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Contract Assignments
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Contract Assignments.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Contract Assignments
      </h2>
      <Projects
        tenantId={tenantId}
        initialProjects={scopedProjectRows}
        initialSites={scopedSites}
        initialClients={scopedClients}
        initialServiceContracts={
          ((serviceContracts as ServiceContractListRow[] | null) ?? []).map(
            (row) => normalizeServiceContractListRow(row),
          )
        }
        initialEmployeeCountByProjectCode={employeeCountByProjectCode}
        fetchError={
          scopedProjects.error ??
          error?.message ??
          sitesError?.message ??
          clientsError?.message ??
          employeesError?.message ??
          serviceContractsError?.message ??
          null
        }
      />
    </>
  );
}
