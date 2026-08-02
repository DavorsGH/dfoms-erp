import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import {
  LANDLORD_NOTIFICATION_SELECT,
  normalizeLandlordNotificationRow,
  type LandlordNotificationRow,
} from "@/utils/landlord-notifications-types";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const session = await getLandlordPortalSession();
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

  const [listResult, unreadResult] = await Promise.all([
    supabase
      .from("landlord_notifications")
      .select(LANDLORD_NOTIFICATION_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    supabase
      .from("landlord_notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .is("read_at", null),
  ]);

  if (listResult.error) {
    return NextResponse.json({ error: listResult.error.message }, { status: 500 });
  }
  if (unreadResult.error) {
    return NextResponse.json(
      { error: unreadResult.error.message },
      { status: 500 },
    );
  }

  const notifications = (
    (listResult.data as LandlordNotificationRow[] | null) ?? []
  ).map(normalizeLandlordNotificationRow);

  return NextResponse.json({
    notifications,
    unreadCount: unreadResult.count ?? 0,
    hasMore: notifications.length === limit,
    limit,
    offset,
  });
}
