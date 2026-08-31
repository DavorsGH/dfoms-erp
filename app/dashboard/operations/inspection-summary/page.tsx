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
import InspectionSummary from "../inspection-summary";
import type { ClientEntry } from "../clients-utils";
import {
  DEFAULT_INSPECTION_PASSING_THRESHOLD,
} from "../operations-register-utils";
import {
  INSPECTION_SUMMARY_SELECT,
  type InspectionSummaryEntry,
  type WorkOrderLookup,
} from "../inspection-summary-utils";
import type { SiteEntry } from "../sites-utils";

export default async function InspectionSummaryPage() {
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
    { data: workOrders, error: workOrdersError },
    scopedEmployees,
    { data: configRows, error: configError },
  ] = await Promise.all([
    supabase
      .from("inspection_summary")
      .select(INSPECTION_SUMMARY_SELECT)
      .order("inspection_date", { ascending: false }),
    supabase
      .from("customers")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .order("site_name", { ascending: true }),
    supabase
      .from("work_orders")
      .select("work_order_no, date, client_id, site_id")
      .order("work_order_no", { ascending: true }),
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
    entriesError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    workOrdersError?.message ??
    configError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Inspection Summary">
      <InspectionSummary
        initialEntries={(entries as InspectionSummaryEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialWorkOrders={(workOrders as WorkOrderLookup[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        inspectionPassingThreshold={
          Number(configRows?.config_value) || DEFAULT_INSPECTION_PASSING_THRESHOLD
        }
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
