import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import ExitManagementRegister from "../exit-management-register";
import {
  EXIT_MANAGEMENT_SELECT,
  type ExitManagementEntry,
} from "../exit-management-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function ExitManagementPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("exit_management")
        .select(EXIT_MANAGEMENT_SELECT)
        .order("exit_date", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Exit Management">
      <ExitManagementRegister
        initialEntries={(data as ExitManagementEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
