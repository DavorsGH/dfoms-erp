import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import AttendanceRegister from "../attendance-register";
import type { AttendanceRegisterEntry } from "../attendance-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function AttendancePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("attendance_register")
        .select("*")
        .order("date", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Attendance Register">
      <AttendanceRegister
        initialEntries={(data as AttendanceRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
