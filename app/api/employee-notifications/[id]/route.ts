import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  EMPLOYEE_NOTIFICATION_SELECT,
  EMPLOYEE_NOTIFICATION_SELECT_LEGACY,
  isMissingActionUrlColumnError,
  normalizeEmployeeNotificationRow,
  type EmployeeNotificationRow,
} from "@/utils/employee-notifications-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Mark a single notification as read (sets read_at if currently null). */
export async function PATCH(_request: Request, context: RouteContext) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId || !auth.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Notification id is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // RLS remains primary; app-level filters are defense-in-depth.
  const { data: existing, error: fetchError } = await supabase
    .from("employee_notifications")
    .select("id, read_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("recipient_user_id", auth.userId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  if (existing.read_at) {
    const currentFull = await supabase
      .from("employee_notifications")
      .select(EMPLOYEE_NOTIFICATION_SELECT)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", auth.userId)
      .maybeSingle();

    const current =
      currentFull.error &&
      isMissingActionUrlColumnError(currentFull.error.message)
        ? await supabase
            .from("employee_notifications")
            .select(EMPLOYEE_NOTIFICATION_SELECT_LEGACY)
            .eq("id", id)
            .eq("tenant_id", tenantId)
            .eq("recipient_user_id", auth.userId)
            .maybeSingle()
        : currentFull;

    return NextResponse.json({
      notification: current.data
        ? normalizeEmployeeNotificationRow(
            current.data as EmployeeNotificationRow,
          )
        : null,
    });
  }

  const now = new Date().toISOString();
  const updatedFull = await supabase
    .from("employee_notifications")
    .update({ read_at: now })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("recipient_user_id", auth.userId)
    .select(EMPLOYEE_NOTIFICATION_SELECT)
    .single();

  const updated =
    updatedFull.error &&
    isMissingActionUrlColumnError(updatedFull.error.message)
      ? await supabase
          .from("employee_notifications")
          .update({ read_at: now })
          .eq("id", id)
          .eq("tenant_id", tenantId)
          .eq("recipient_user_id", auth.userId)
          .select(EMPLOYEE_NOTIFICATION_SELECT_LEGACY)
          .single()
      : updatedFull;

  if (updated.error) {
    return NextResponse.json({ error: updated.error.message }, { status: 400 });
  }

  return NextResponse.json({
    notification: normalizeEmployeeNotificationRow(
      updated.data as EmployeeNotificationRow,
    ),
  });
}
