import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import LeaveManagement from "../leave-management";
import type { LeaveManagementEntry } from "../leave-management-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function LeavePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("leave_management")
        .select("*")
        .order("start_date", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Leave Management">
      <LeaveManagement
        initialEntries={(data as LeaveManagementEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
