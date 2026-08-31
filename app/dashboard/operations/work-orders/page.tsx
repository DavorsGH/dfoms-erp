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
import type { ClientEntry } from "../clients-utils";
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
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    scopedEmployees,
    { data: configRows, error: configError },
  ] = await Promise.all([
    supabase
      .from("work_orders")
      .select(WORK_ORDER_SELECT)
      .order("date", { ascending: false })
      .order("work_order_no", { ascending: false }),
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
    supabase
      .from("operations_config")
      .select("config_value")
      .eq("config_key", "inspection_passing_threshold")
      .maybeSingle(),
  ]);

  const fetchError =
    scopedEmployees.error ??
    workOrdersError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    configError?.message ??
    null;

  const inspectionPassingThreshold =
    Number(configRows?.config_value) || DEFAULT_INSPECTION_PASSING_THRESHOLD;

  return (
    <OperationsShell sectionTitle="Work Orders">
      <WorkOrders
        initialWorkOrders={(workOrders as WorkOrderEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        inspectionPassingThreshold={inspectionPassingThreshold}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
