import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import OperationsShell from "../operations-shell";
import Clients from "../clients";
import type { ClientEntry } from "../clients-utils";

export default async function ClientsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .order("client_name", { ascending: true }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <OperationsShell sectionTitle="Clients">
      <Clients
        initialClients={(data as ClientEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
