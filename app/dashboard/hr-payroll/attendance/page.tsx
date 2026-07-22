import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import AttendanceRegister from "../attendance-register";
import {
  getAttendanceMonthBounds,
  type AttendanceRegisterEntry,
} from "../attendance-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function AttendancePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const now = new Date();
  const initialYear = now.getFullYear();
  const initialMonth = now.getMonth() + 1;
  const { start, end } = getAttendanceMonthBounds(initialYear, initialMonth);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("attendance_register")
        .select("*")
        .gte("date", start)
        .lte("date", end)
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
        initialYear={initialYear}
        initialMonth={initialMonth}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
