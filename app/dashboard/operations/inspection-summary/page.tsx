import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
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

  const [
    { data: entries, error: entriesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: workOrders, error: workOrdersError },
    { data: employees, error: employeesError },
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
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase
      .from("operations_config")
      .select("config_value")
      .eq("config_key", "inspection_passing_threshold")
      .maybeSingle(),
  ]);

  const fetchError =
    entriesError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    workOrdersError?.message ??
    employeesError?.message ??
    configError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Inspection Summary">
      <InspectionSummary
        initialEntries={(entries as InspectionSummaryEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialWorkOrders={(workOrders as WorkOrderLookup[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        inspectionPassingThreshold={
          Number(configRows?.config_value) || DEFAULT_INSPECTION_PASSING_THRESHOLD
        }
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
