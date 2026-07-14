import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canManageLeaveBalances } from "@/utils/rbac-access";
import type { AppRole } from "../../user-account-types";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";
import LeaveBalances from "../leave-balances";
import type {
  EmployeeLeaveBalance,
  LeaveType,
} from "../../self-service/leave-request-utils";

export default async function LeaveBalancesPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;
  const currentYear = new Date().getFullYear();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: balances, error: balancesError },
    { data: employees, error: employeesError },
    { data: leaveTypes, error: typesError },
  ] = await Promise.all([
    supabase
      .from("employee_leave_balances")
      .select("*, leave_types(type_name), employees(full_name, staff_id)")
      .eq("year", currentYear)
      .order("employee_id"),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase.from("leave_types").select("*").order("type_name"),
  ]);

  const fetchError =
    balancesError?.message ??
    employeesError?.message ??
    typesError?.message ??
    null;

  return (
    <HrPayrollShell sectionTitle="Leave Balances">
      <LeaveBalances
        initialBalances={(balances as EmployeeLeaveBalance[] | null) ?? []}
        employees={filterActiveEmployees((employees as HrEmployee[] | null) ?? [])}
        leaveTypes={(leaveTypes as LeaveType[] | null) ?? []}
        currentYear={currentYear}
        canManage={canManageLeaveBalances(role)}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
