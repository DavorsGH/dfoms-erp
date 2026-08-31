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
import ComplaintRegister from "../complaint-register";
import type { ClientEntry } from "../clients-utils";
import {
  COMPLAINT_REGISTER_SELECT,
  type ComplaintRegisterEntry,
} from "../complaint-register-utils";
import type { SiteEntry } from "../sites-utils";

export default async function ComplaintRegisterPage() {
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
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    scopedEmployees,
  ] = await Promise.all([
    supabase
      .from("complaint_register")
      .select(COMPLAINT_REGISTER_SELECT)
      .order("date_received", { ascending: false }),
    supabase
      .from("customers")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
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
    clientsError?.message ??
    sitesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Complaint Register">
      <ComplaintRegister
        initialEntries={(entries as ComplaintRegisterEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
