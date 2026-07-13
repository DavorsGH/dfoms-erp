import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import CorrectiveActions from "../corrective-actions";
import type { ClientEntry } from "../clients-utils";
import {
  CORRECTIVE_ACTION_SELECT,
  type CorrectiveActionEntry,
  type FailedIssueLookupOption,
  type WorkOrderLookupOption,
} from "../corrective-actions-utils";

export default async function CorrectiveActionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: entries, error: entriesError },
    { data: clients, error: clientsError },
    { data: workOrders, error: workOrdersError },
    { data: failedIssues, error: failedIssuesError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase
      .from("corrective_actions")
      .select(CORRECTIVE_ACTION_SELECT)
      .order("date_raised", { ascending: false }),
    supabase
      .from("clients")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("work_orders")
      .select("work_order_no, date")
      .order("work_order_no", { ascending: true }),
    supabase
      .from("failed_inspections")
      .select("issue_no, date_identified, problem_description")
      .order("date_identified", { ascending: false }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
  ]);

  const fetchError =
    entriesError?.message ??
    clientsError?.message ??
    workOrdersError?.message ??
    failedIssuesError?.message ??
    employeesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Corrective Actions">
      <CorrectiveActions
        initialEntries={(entries as CorrectiveActionEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialWorkOrders={(workOrders as WorkOrderLookupOption[] | null) ?? []}
        initialFailedIssues={(failedIssues as FailedIssueLookupOption[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
