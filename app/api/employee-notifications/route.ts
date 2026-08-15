import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentAuthUid, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  EMPLOYEE_NOTIFICATION_SELECT,
  EMPLOYEE_NOTIFICATION_SELECT_LEGACY,
  isMissingActionUrlColumnError,
  normalizeEmployeeNotificationRow,
  type EmployeeNotificationRow,
} from "@/utils/employee-notifications-types";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function isCountOnlyRequest(searchParams: URLSearchParams): boolean {
  const value = searchParams.get("countOnly");
  return value === "1" || value === "true";
}

export async function GET(request: Request) {
  const userId = await getCurrentAuthUid();
  const tenantId = await getCurrentUserTenantId();
  if (!userId || !tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const countOnly = isCountOnlyRequest(searchParams);

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const unreadQuery = supabase
    .from("employee_notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("recipient_user_id", userId)
    .is("read_at", null);

  if (countOnly) {
    const unreadResult = await unreadQuery;
    if (unreadResult.error) {
      return NextResponse.json({ error: unreadResult.error.message }, { status: 500 });
    }
    return NextResponse.json({
      unreadCount: unreadResult.count ?? 0,
    });
  }

  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT),
  );
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

  const listQuery = async (): Promise<{
    listData: unknown[] | null;
    listError: { message: string } | null;
  }> => {
    const listResult = await supabase
      .from("employee_notifications")
      .select(EMPLOYEE_NOTIFICATION_SELECT)
      .eq("tenant_id", tenantId)
      .eq("recipient_user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (
      listResult.error &&
      isMissingActionUrlColumnError(listResult.error.message)
    ) {
      const legacy = await supabase
        .from("employee_notifications")
        .select(EMPLOYEE_NOTIFICATION_SELECT_LEGACY)
        .eq("tenant_id", tenantId)
        .eq("recipient_user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      return { listData: legacy.data, listError: legacy.error };
    }

    return { listData: listResult.data, listError: listResult.error };
  };

  const [unreadResult, listOutcome] = await Promise.all([
    unreadQuery,
    listQuery(),
  ]);

  if (unreadResult.error) {
    return NextResponse.json({ error: unreadResult.error.message }, { status: 500 });
  }

  const { listData, listError } = listOutcome;
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const notifications = (
    (listData as EmployeeNotificationRow[] | null) ?? []
  ).map(normalizeEmployeeNotificationRow);

  return NextResponse.json({
    notifications,
    unreadCount: unreadResult.count ?? 0,
    hasMore: notifications.length === limit,
    limit,
    offset,
  });
}
