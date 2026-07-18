import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
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

  const [
    { data: workOrders, error: workOrdersError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: employees, error: employeesError },
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
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase
      .from("operations_config")
      .select("config_value")
      .eq("config_key", "inspection_passing_threshold")
      .maybeSingle(),
  ]);

  const fetchError =
    workOrdersError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    employeesError?.message ??
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
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        inspectionPassingThreshold={inspectionPassingThreshold}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
