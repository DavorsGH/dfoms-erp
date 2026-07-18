import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import IncidentRegister from "../incident-register";
import type { ClientEntry } from "../clients-utils";
import {
  INCIDENT_REGISTER_SELECT,
  type IncidentRegisterEntry,
} from "../incident-register-utils";
import type { SiteEntry } from "../sites-utils";

export default async function IncidentRegisterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: entries, error: entriesError },
    { data: clients, error: clientsError },
    { data: sites, error: sitesError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase
      .from("incident_register")
      .select(INCIDENT_REGISTER_SELECT)
      .order("date", { ascending: false }),
    supabase
      .from("customers")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .order("site_name", { ascending: true }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
  ]);

  const fetchError =
    entriesError?.message ??
    clientsError?.message ??
    sitesError?.message ??
    employeesError?.message ??
    null;

  return (
    <OperationsShell sectionTitle="Incident Register">
      <IncidentRegister
        initialEntries={(entries as IncidentRegisterEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
