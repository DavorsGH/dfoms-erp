import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import Sites from "../sites";
import type { ClientEntry } from "../clients-utils";
import { SITE_SELECT, type SiteEntry } from "../sites-utils";

export default async function SitesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: sites, error: sitesError },
    { data: clients, error: clientsError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase.from("sites").select(SITE_SELECT).order("site_name", { ascending: true }),
    supabase
      .from("clients")
      .select("client_id, client_name")
      .order("client_name", { ascending: true }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
  ]);

  const fetchError =
    sitesError?.message ?? clientsError?.message ?? employeesError?.message ?? null;

  return (
    <OperationsShell sectionTitle="Sites">
      <Sites
        initialSites={(sites as SiteEntry[] | null) ?? []}
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
