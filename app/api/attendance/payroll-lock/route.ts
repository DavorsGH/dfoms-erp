import { NextResponse } from "next/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { requireAuthenticated } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { payrollMonthIsLocked } from "@/lib/attendance-exception-apply";
import { payrollLockAttendanceMessage } from "@/lib/attendance-exception-decision";

export async function POST(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { date?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const date = body.date?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Choose a date." }, { status: 400 });
  }

  const lock = await payrollMonthIsLocked(createAdminClient(), tenantId, date);
  if (lock.error) {
    return NextResponse.json({ error: lock.error }, { status: 500 });
  }

  return NextResponse.json({
    locked: lock.locked,
    message: lock.locked ? payrollLockAttendanceMessage(date) : null,
  });
}
