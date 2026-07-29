import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import {
  EMPLOYEE_NOTIFICATION_SELECT,
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

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Notification id is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: existing, error: fetchError } = await supabase
    .from("employee_notifications")
    .select("id, read_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  if (existing.read_at) {
    const { data: current } = await supabase
      .from("employee_notifications")
      .select(EMPLOYEE_NOTIFICATION_SELECT)
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json({
      notification: current
        ? normalizeEmployeeNotificationRow(current as EmployeeNotificationRow)
        : null,
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("employee_notifications")
    .update({ read_at: now })
    .eq("id", id)
    .select(EMPLOYEE_NOTIFICATION_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    notification: normalizeEmployeeNotificationRow(
      data as EmployeeNotificationRow,
    ),
  });
}
