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
import Sites from "../../operations/sites";
import {
  normalizeSiteEntry,
  SITE_SELECT,
  type SiteEntry,
} from "../../operations/sites-utils";
import { siteProjectCode } from "@/lib/operations-contract-scope";
import {
  listSiteFormContractChoices,
  type SiteFormProject,
} from "@/lib/site-form-contracts";

export default async function AdministrationSitesPage() {
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
    { data: sites, error: sitesError },
    { data: projects, error: projectsError },
    { data: serviceContracts, error: contractsError },
    scopedEmployees,
  ] = await Promise.all([
    supabase.from("sites").select(SITE_SELECT).order("site_name", { ascending: true }),
    supabase
      .from("projects")
      .select(
        "id, project_code, project_name, service_contract_id, contract_type, is_archived",
      )
      .order("project_name", { ascending: true }),
    supabase.from("service_contracts").select("id, client_id"),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({
          employees: [] as HrEmployee[],
          error: "Unable to resolve your workspace.",
        }),
  ]);

  const normalizedSites = ((sites as SiteEntry[] | null) ?? []).map(
    normalizeSiteEntry,
  );
  const contracts = listSiteFormContractChoices({
    projects: (projects as SiteFormProject[] | null) ?? [],
    sites: normalizedSites.map((site) => ({
      client_id: site.client_id,
      project_code: siteProjectCode(site) || null,
    })),
    serviceContracts:
      (serviceContracts as Array<{ id: string; client_id: string | null }> | null) ??
      [],
  });

  const fetchError =
    scopedEmployees.error ??
    sitesError?.message ??
    projectsError?.message ??
    contractsError?.message ??
    null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Site Assignments
      </h2>
      <Sites
        initialSites={normalizedSites}
        initialContracts={contracts}
        initialEmployees={scopedEmployees.employees}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </>
  );
}
