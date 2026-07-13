import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import FailedInspections from "../failed-inspections";
import type { ClientEntry } from "../clients-utils";
import {
  FAILED_INSPECTION_SELECT,
  type FailedInspectionEntry,
  type InspectionChecklistLookup,
} from "../failed-inspections-utils";
import type { SiteEntry } from "../sites-utils";

export default async function FailedInspectionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: entries, error: entriesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: checklists, error: checklistsError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase
      .from("failed_inspections")
      .select(FAILED_INSPECTION_SELECT)
      .order("date_identified", { ascending: false }),
    supabase
      .from("clients")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .order("site_name", { ascending: true }),
    supabase
      .from("inspection_summary")
      .select("checklist_id, inspection_date, client_id, site_id")
      .order("inspection_date", { ascending: false }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
  ]);

  const fetchError =
    entriesError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    checklistsError?.message ??
    employeesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Failed Inspections">
      <FailedInspections
        initialEntries={(entries as FailedInspectionEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialChecklists={(checklists as InspectionChecklistLookup[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
