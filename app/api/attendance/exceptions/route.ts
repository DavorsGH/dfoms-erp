import { NextResponse } from "next/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  canDecideAttendanceException,
  ATTENDANCE_EXCEPTION_VIEW_ROLES,
} from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";

export async function GET(request: Request) {
  const auth = await requireTenantRoleIn(ATTENDANCE_EXCEPTION_VIEW_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const view = new URL(request.url).searchParams.get("view") ?? "pending";
  const role = await getCurrentUserRole();
  const admin = createAdminClient();
  let query = admin
    .from("attendance_register")
    .select(
      "id, date, staff_id, scheduled_shift, scheduled_day_type, scheduled_start, scheduled_end, clock_in, clock_out, late_minutes, early_leave_minutes, exception_status, attendance_status, review_note",
    )
    .eq("tenant_id", auth.tenantId);

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
  const staffIds = [...new Set(rows.map((row) => String(row.staff_id ?? "")).filter(Boolean))];
  const names = new Map<string, string>();
  if (staffIds.length > 0) {
    const { data: employees, error: employeesError } = await admin
      .from("employees")
      .select("staff_id, full_name")
      .eq("tenant_id", auth.tenantId)
      .in("staff_id", staffIds);
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
