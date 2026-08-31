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
import Sites from "../sites";
import type { ClientEntry } from "../clients-utils";
import { SITE_SELECT, type SiteEntry } from "../sites-utils";

export default async function SitesPage() {
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
    { data: clients, error: clientsError },
    scopedEmployees,
  ] = await Promise.all([
    supabase.from("sites").select(SITE_SELECT).order("site_name", { ascending: true }),
    supabase
      .from("customers")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({
          employees: [] as HrEmployee[],
          error: "Unable to resolve your workspace.",
        }),
  ]);

  const fetchError =
    scopedEmployees.error ??
    sitesError?.message ??
    clientsError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Sites">
      <Sites
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
