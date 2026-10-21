import { NextResponse } from "next/server";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { ATTENDANCE_EXCEPTION_DECIDE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { applyAttendanceExceptionDecision } from "@/lib/attendance-exception-apply";
import { isAttendanceExceptionDecision } from "@/lib/attendance-exception-decision";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  fetchScopedStaffIds,
  staffIdInActiveScope,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(ATTENDANCE_EXCEPTION_DECIDE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: {
    id?: string;
    decision?: string;
    note?: string | null;
    attendanceStatus?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  const decision = body.decision?.trim() ?? "";
  if (!id || !isAttendanceExceptionDecision(decision)) {
    return NextResponse.json({ error: "Choose a decision for this row." }, { status: 400 });
  }

  const reviewedBy = await getCurrentAuthUid();
  if (!reviewedBy) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("attendance_register")
    .select("id, staff_id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Attendance row not found." }, { status: 404 });
  }

  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { staffIds, error: staffScopeError } = await fetchScopedStaffIds(
    admin,
    auth.tenantId,
    buScope,
  );
  if (staffScopeError) {
    return NextResponse.json({ error: staffScopeError }, { status: 500 });
  }
  const staffId = String(existing.staff_id ?? "").trim();
  if (!staffIdInActiveScope(staffId, staffIds)) {
    return NextResponse.json(
      {
        error:
          "This attendance exception is outside the active business unit. Switch business unit before deciding.",
      },
      { status: 403 },
    );
  }

  const result = await applyAttendanceExceptionDecision(admin, {
    tenantId: auth.tenantId,
    attendanceRegisterId: id,
    decision,
    note: body.note,
    reviewedBy,
    attendanceStatus: body.attendanceStatus,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, row: result.row });
}
