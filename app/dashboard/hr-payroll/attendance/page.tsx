import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole, getCurrentUserTenantId, getActiveBusinessUnitId, getViewAllBusinessUnits } from "@/utils/dashboard-auth";
import { canDecideAttendanceException } from "@/utils/rbac-access";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import AttendanceExceptionsPanel from "../attendance-exceptions-panel";
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
import { getDefaultReportPeriod } from "../../reports/report-period-utils";

export default async function AttendancePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { year: initialYear, month: initialMonth } = getDefaultReportPeriod();
  const { start, end } = getAttendanceMonthBounds(initialYear, initialMonth);

  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits, role] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserRole(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { staffIds, error: staffScopeError } = tenantId
    ? await fetchScopedStaffIds(supabase, tenantId, buScope)
    : {
        staffIds: buScope.mode === "all" ? null : [],
        error:
          buScope.mode === "all"
            ? null
            : "Unable to resolve your workspace.",
      };

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      applyStaffIdScope(
        supabase
          .from("attendance_register")
          .select("*")
          .gte("date", start)
          .lte("date", end),
        staffIds,
      ).order("date", { ascending: false }),
      applyBusinessUnitScope(
        supabase.from("employees").select(HR_EMPLOYEE_SELECT),
        buScope,
      ).order("full_name"),
    ]);

  const fetchError =
    staffScopeError ?? error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Attendance Register">
      <AttendanceExceptionsPanel />
      <AttendanceRegister
        initialEntries={(data as AttendanceRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialYear={initialYear}
        initialMonth={initialMonth}
        fetchError={fetchError}
        tenantId={tenantId}
        canDecide={canDecideAttendanceException(role)}
      />
    </HrPayrollShell>
  );
}
