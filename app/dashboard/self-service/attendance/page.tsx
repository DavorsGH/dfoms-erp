import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserEmployeeId } from "@/utils/dashboard-auth";
import type { AttendanceRegisterEntry } from "../../hr-payroll/attendance-register-utils";
import MyAttendance from "../my-attendance";
import SelfServiceShell from "../self-service-shell";

export default async function SelfServiceAttendancePage() {
  const employeeId = await getCurrentUserEmployeeId();

  if (!employeeId) {
    return (
      <SelfServiceShell sectionTitle="My Attendance">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to an employee record.
        </div>
      </SelfServiceShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("staff_id")
    .eq("employee_id", employeeId)
    .maybeSingle();

  let fetchError = employeeError?.message ?? null;
  let entries: AttendanceRegisterEntry[] = [];

  if (!fetchError && employee?.staff_id) {
    const { data, error } = await supabase
      .from("attendance_register")
      .select("*")
      .eq("staff_id", employee.staff_id)
      .order("date", { ascending: false });

    fetchError = error?.message ?? null;
    entries = (data as AttendanceRegisterEntry[] | null) ?? [];
  }

  return (
    <SelfServiceShell sectionTitle="My Attendance">
      <MyAttendance initialEntries={entries} fetchError={fetchError} />
    </SelfServiceShell>
  );
}
