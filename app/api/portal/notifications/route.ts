import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  LESSEE_NOTIFICATION_SELECT,
  LESSEE_NOTIFICATION_SELECT_LEGACY,
  isMissingActionUrlColumnError,
  normalizeLesseeNotificationRow,
  type LesseeNotificationRow,
} from "@/utils/lessee-notifications-types";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  let listData: unknown[] | null = null;
  let listError: { message: string } | null = null;

  {
    const listResult = await supabase
      .from("lessee_notifications")
      .select(LESSEE_NOTIFICATION_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .eq("lessee_id", session.lesseeId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (
      listResult.error &&
      isMissingActionUrlColumnError(listResult.error.message)
    ) {
      const legacy = await supabase
        .from("lessee_notifications")
        .select(LESSEE_NOTIFICATION_SELECT_LEGACY)
        .eq("tenant_id", session.tenantId)
        .eq("recipient_user_id", session.authUserId)
        .eq("lessee_id", session.lesseeId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
      listData = legacy.data;
      listError = legacy.error;
    } else {
      listData = listResult.data;
      listError = listResult.error;
    }
  }

  const unreadResult = await supabase
    .from("lessee_notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("lessee_id", session.lesseeId)
    .is("read_at", null);

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }
  if (unreadResult.error) {
    return NextResponse.json(
      { error: unreadResult.error.message },
      { status: 500 },
    );
  }

  const notifications = (
    (listData as LesseeNotificationRow[] | null) ?? []
  ).map(normalizeLesseeNotificationRow);

  return NextResponse.json({
    notifications,
    unreadCount: unreadResult.count ?? 0,
    hasMore: notifications.length === limit,
    limit,
    offset,
  });
}
