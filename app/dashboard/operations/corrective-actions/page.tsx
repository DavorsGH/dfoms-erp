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
import { fetchScopedActiveEmployees } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import type { HrEmployee } from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import CorrectiveActions from "../corrective-actions";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
import type { SiteEntry } from "../sites-utils";
import {
  CORRECTIVE_ACTION_SELECT,
  type CorrectiveActionEntry,
  type FailedIssueLookupOption,
  type WorkOrderLookupOption,
} from "../corrective-actions-utils";

export default async function CorrectiveActionsPage() {
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
    { data: workOrders, error: workOrdersError },
    { data: failedIssues, error: failedIssuesError },
    scopedEmployees,
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase.from("corrective_actions").select(CORRECTIVE_ACTION_SELECT),
      buScope,
    ).order("date_raised", { ascending: false }),
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
    supabase
      .from("work_orders")
      .select("work_order_no, date")
      .order("work_order_no", { ascending: true }),
    supabase
      .from("failed_inspections")
      .select("issue_no, date_identified, problem_description")
      .order("date_identified", { ascending: false }),
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
    workOrdersError?.message ??
    failedIssuesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Corrective Actions">
      <CorrectiveActions
        initialEntries={(entries as CorrectiveActionEntry[] | null) ?? []}
        initialProjects={(projects as RosterContractProject[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialWorkOrders={(workOrders as WorkOrderLookupOption[] | null) ?? []}
        initialFailedIssues={(failedIssues as FailedIssueLookupOption[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
