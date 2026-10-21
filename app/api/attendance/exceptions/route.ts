import { NextResponse } from "next/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  canDecideAttendanceException,
  ATTENDANCE_EXCEPTION_VIEW_ROLES,
} from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(ATTENDANCE_EXCEPTION_VIEW_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const view = new URL(request.url).searchParams.get("view") ?? "pending";
  const role = await getCurrentUserRole();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const admin = createAdminClient();
  const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
    admin,
    auth.tenantId,
    buScope,
  );
  if (staffScopeError) {
    return NextResponse.json({ error: staffScopeError }, { status: 500 });
  }

  let query = applyStaffIdScope(
    admin
      .from("attendance_register")
      .select(
        "id, date, staff_id, scheduled_shift, scheduled_day_type, scheduled_start, scheduled_end, clock_in, clock_out, late_minutes, early_leave_minutes, exception_status, attendance_status, review_note",
      )
      .eq("tenant_id", auth.tenantId),
    staffIds,
  );

  if (view === "decided") {
    query = query.in("exception_status", ["full_day", "half_day", "absent"]);
  } else if (view === "all") {
    query = query.in("exception_status", [
      "pending",
      "full_day",
      "half_day",
      "absent",
    ]);
  } else {
    query = query.eq("exception_status", "pending");
  }

  const { data, error } = await query
    .order("date", { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const rowStaffIds = [
    ...new Set(rows.map((row) => String(row.staff_id ?? "")).filter(Boolean)),
  ];
  const names = new Map<string, string>();
  if (rowStaffIds.length > 0) {
    const { data: employees, error: employeesError } = await admin
      .from("employees")
      .select("staff_id, full_name")
      .eq("tenant_id", auth.tenantId)
      .in("staff_id", rowStaffIds);
    if (employeesError) {
      return NextResponse.json({ error: employeesError.message }, { status: 500 });
    }
    for (const employee of employees ?? []) {
      names.set(String(employee.staff_id), String(employee.full_name ?? ""));
    }
  }

  return NextResponse.json({
    canDecide: canDecideAttendanceException(role),
    rows: rows.map((row) => ({
      ...row,
      employee_name: names.get(String(row.staff_id)) ?? "",
    })),
  });
}
