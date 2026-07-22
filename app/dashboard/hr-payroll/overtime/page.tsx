import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../../approver-utils";
import type { Approver } from "../../lookup-types";
import OvertimeRegister from "../overtime-register";
import type { OvertimeRegisterEntry } from "../overtime-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function OvertimePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data, error },
    { data: employees, error: employeesError },
    { data: approvers, error: approversError },
  ] = await Promise.all([
    supabase
      .from("overtime_register")
      .select("*")
      .order("date", { ascending: false }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true }),
  ]);

  const fetchError =
    error?.message ?? employeesError?.message ?? approversError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Overtime Register">
      <OvertimeRegister
        initialEntries={(data as OvertimeRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
