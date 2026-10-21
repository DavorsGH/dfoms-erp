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
import WorkOrders from "../work-orders";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
import { DEFAULT_INSPECTION_PASSING_THRESHOLD } from "../operations-register-utils";
import type { SiteEntry } from "../sites-utils";
import {
  WORK_ORDER_SELECT,
  type WorkOrderEntry,
} from "../work-orders-utils";

export default async function WorkOrdersPage() {
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
    { data: workOrders, error: workOrdersError },
    { data: projects, error: projectsError },
    { data: sites, error: sitesError },
    { data: inspections, error: inspectionsError },
    scopedEmployees,
    { data: configRows, error: configError },
  ] = await Promise.all([
    supabase
      .from("work_orders")
      .select(WORK_ORDER_SELECT)
      .order("date", { ascending: false })
      .order("work_order_no", { ascending: false }),
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
      .from("inspection_summary")
      .select("checklist_id, inspection_date, site_id")
      .gte(
        "inspection_date",
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      )
      .order("inspection_date", { ascending: false }),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({
          employees: [] as HrEmployee[],
          error: "Unable to resolve your workspace.",
        }),
    supabase
      .from("operations_config")
      .select("config_value")
      .eq("config_key", "inspection_passing_threshold")
      .maybeSingle(),
  ]);

  const fetchError =
    scopedEmployees.error ??
    workOrdersError?.message ??
    projectsError?.message ??
    sitesError?.message ??
    inspectionsError?.message ??
    configError?.message ??
    null;

  const inspectionPassingThreshold =
    Number(configRows?.config_value) || DEFAULT_INSPECTION_PASSING_THRESHOLD;

  return (
    <OperationsShell sectionTitle="Work Orders">
      <WorkOrders
        initialWorkOrders={(workOrders as WorkOrderEntry[] | null) ?? []}
        initialProjects={(projects as RosterContractProject[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        initialInspections={
          (inspections as
            | {
                checklist_id: string;
                inspection_date: string | null;
                site_id: string | null;
              }[]
            | null) ?? []
        }
        inspectionPassingThreshold={inspectionPassingThreshold}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
