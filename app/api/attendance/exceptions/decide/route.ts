import { NextResponse } from "next/server";
import { getCurrentAuthUid } from "@/utils/dashboard-auth";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { ATTENDANCE_EXCEPTION_DECIDE_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { applyAttendanceExceptionDecision } from "@/lib/attendance-exception-apply";
import { isAttendanceExceptionDecision } from "@/lib/attendance-exception-decision";

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

  const result = await applyAttendanceExceptionDecision(createAdminClient(), {
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
