import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import {
  EMPLOYEE_NOTIFICATION_SELECT,
  normalizeEmployeeNotificationRow,
  type EmployeeNotificationRow,
} from "@/utils/employee-notifications-types";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT),
  );
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  // RLS already restricts to recipient_user_id = auth.uid().
  const [listResult, unreadResult] = await Promise.all([
    supabase
      .from("employee_notifications")
      .select(EMPLOYEE_NOTIFICATION_SELECT)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    supabase
      .from("employee_notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
  ]);

  if (listResult.error) {
    return NextResponse.json({ error: listResult.error.message }, { status: 500 });
  }
  if (unreadResult.error) {
    return NextResponse.json({ error: unreadResult.error.message }, { status: 500 });
  }

  const notifications = (
    (listResult.data as EmployeeNotificationRow[] | null) ?? []
  ).map(normalizeEmployeeNotificationRow);

  return NextResponse.json({
    notifications,
    unreadCount: unreadResult.count ?? 0,
    hasMore: notifications.length === limit,
    limit,
    offset,
  });
}
