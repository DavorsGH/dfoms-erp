import { cookies } from "next/headers";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import {
  BADGE_POLL_AUTH_OPTS,
  ROUTE_HANDLER_AUTH_OPTS,
} from "@/lib/middleware-trust-policy";
import {
  attachBadgeRouteTrustDiagnosticHeaders,
  isTrustDiagEnabled,
  loadBadgeRouteTrustDiagnostics,
} from "@/utils/badge-route-trust-diagnostics";
import {
  LANDLORD_NOTIFICATION_SELECT,
  normalizeLandlordNotificationRow,
  type LandlordNotificationRow,
} from "@/utils/landlord-notifications-types";
import { createClient } from "@/utils/supabase/server";
import { jsonWithRouteTiming } from "@/utils/route-timing-headers";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function isCountOnlyRequest(searchParams: URLSearchParams): boolean {
  const value = searchParams.get("countOnly");
  return value === "1" || value === "true";
}

export async function GET(request: Request) {
  const routeStartedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const countOnly = isCountOnlyRequest(searchParams);
  const authOpts = countOnly ? BADGE_POLL_AUTH_OPTS : ROUTE_HANDLER_AUTH_OPTS;

  const trustStartedAt = Date.now();
  const badgeTrustDiag =
    countOnly && isTrustDiagEnabled()
      ? await loadBadgeRouteTrustDiagnostics()
      : null;
  const session = await getLandlordPortalSession(authOpts);
  const trustMs = Date.now() - trustStartedAt;
  if (!session) {
    return jsonWithRouteTiming({ error: "Unauthorized" }, routeStartedAt, {
      status: 401,
    });
  }

  const setupStartedAt = Date.now();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const setupMs = Date.now() - setupStartedAt;

  const unreadQuery = supabase
    .from("landlord_notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .is("read_at", null);

  if (countOnly) {
    const dbStartedAt = Date.now();
    const unreadResult = await unreadQuery;
    const dbMs = Date.now() - dbStartedAt;
    const badgeSegments = { setupMs, trustMs, dbMs };
    if (unreadResult.error) {
      return jsonWithRouteTiming(
        { error: unreadResult.error.message },
        routeStartedAt,
        { status: 500 },
        badgeSegments,
      );
    }
    const response = jsonWithRouteTiming(
      {
        unreadCount: unreadResult.count ?? 0,
      },
      routeStartedAt,
      undefined,
      badgeSegments,
    );
    if (badgeTrustDiag) {
      attachBadgeRouteTrustDiagnosticHeaders(response, badgeTrustDiag);
    }
    return response;
  }

  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT),
  );
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

  const [unreadResult, listResult] = await Promise.all([
    unreadQuery,
    supabase
      .from("landlord_notifications")
      .select(LANDLORD_NOTIFICATION_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
  ]);

  if (unreadResult.error) {
    return jsonWithRouteTiming(
      { error: unreadResult.error.message },
      routeStartedAt,
      { status: 500 },
    );
  }
  if (listResult.error) {
    return jsonWithRouteTiming(
      { error: listResult.error.message },
      routeStartedAt,
      { status: 500 },
    );
  }

  const notifications = (
    (listResult.data as LandlordNotificationRow[] | null) ?? []
  ).map(normalizeLandlordNotificationRow);

  return jsonWithRouteTiming(
    {
      notifications,
      unreadCount: unreadResult.count ?? 0,
      hasMore: notifications.length === limit,
      limit,
      offset,
    },
    routeStartedAt,
  );
}
