import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getCurrentUserEmployeeId,
  getCurrentUserRole,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { resolveAttendanceMode } from "@/lib/attendance-mode";
import type { AttendanceRegisterEntry } from "../../hr-payroll/attendance-register-utils";
import type { AttendanceContractRef } from "../my-attendance-utils";
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
    .select("staff_id, contract_project, attendance_mode")
    .eq("employee_id", employeeId)
    .maybeSingle();
  const attendanceMode = resolveAttendanceMode(
    employee,
    await getCurrentUserRole(),
  );

  let fetchError = employeeError?.message ?? null;
  let entries: AttendanceRegisterEntry[] = [];
  let projects: AttendanceContractRef[] = [];

  if (!fetchError && employee?.staff_id) {
    const [attendance, projectResult] = await Promise.all([
      supabase
        .from("attendance_register")
        .select("*")
        .eq("staff_id", employee.staff_id)
        .order("date", { ascending: false }),
      supabase.from("projects").select("project_code, project_name"),
    ]);

    fetchError = attendance.error?.message ?? null;
    entries = (attendance.data as AttendanceRegisterEntry[] | null) ?? [];
    projects =
      (projectResult.data as AttendanceContractRef[] | null)?.filter(
        (project) => project.project_code && project.project_name,
      ) ?? [];
    if (projects.length === 0) {
      projects = await loadTenantProjectNames();
    }
  }

  return (
    <SelfServiceShell sectionTitle="My Attendance" hideSectionTitle>
      <MyAttendance
        initialEntries={entries}
        fetchError={fetchError}
        employeeContract={employee?.contract_project ?? null}
        projects={projects}
        attendanceMode={attendanceMode}
      />
    </SelfServiceShell>
  );
}

async function loadTenantProjectNames(): Promise<AttendanceContractRef[]> {
  try {
    const tenantId = await getCurrentUserTenantId();
    if (!tenantId) {
      return [];
    }
    const admin = createAdminClient();
    const { data } = await admin
      .from("projects")
      .select("project_code, project_name")
      .eq("tenant_id", tenantId);
    return ((data as AttendanceContractRef[] | null) ?? []).filter(
      (project) => project.project_code && project.project_name,
    );
  } catch {
    return [];
  }
}
