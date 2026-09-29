import { cookies } from "next/headers";
import { getClientPortalSession } from "@/utils/client-portal-auth";
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
  CLIENT_NOTIFICATION_SELECT,
  normalizeClientNotificationRow,
  type ClientNotificationRow,
} from "@/utils/client-notifications-types";
import { createClient } from "@/utils/supabase/server";
import { jsonWithRouteTiming } from "@/utils/route-timing-headers";
import { isNotificationBadgeApiRequest } from "@/lib/notification-badge-api";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const routeStartedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const isBadgePoll = isNotificationBadgeApiRequest(
    new URL(request.url).pathname,
    searchParams,
  );
  const authOpts = isBadgePoll ? BADGE_POLL_AUTH_OPTS : ROUTE_HANDLER_AUTH_OPTS;

  const trustStartedAt = Date.now();
  const badgeTrustDiag =
    isBadgePoll && isTrustDiagEnabled()
      ? await loadBadgeRouteTrustDiagnostics()
      : null;
  const session = await getClientPortalSession(authOpts);
  const trustMs = Date.now() - trustStartedAt;
  if (!session) {
    return jsonWithRouteTiming({ error: "Unauthorized" }, routeStartedAt, {
      status: 401,
    });
  }
  const rawLimit = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT),
  );
  const rawOffset = Number(searchParams.get("offset") ?? 0);
  const offset = Math.max(0, Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0);

  const setupStartedAt = Date.now();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const setupMs = Date.now() - setupStartedAt;

  const unreadQuery = supabase
    .from("client_notifications")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("client_id", session.clientId)
    .is("read_at", null);

  if (isBadgePoll) {
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
        notifications: [],
        unreadCount: unreadResult.count ?? 0,
        hasMore: false,
        limit,
        offset,
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

  const [listResult, unreadResult] = await Promise.all([
    supabase
      .from("client_notifications")
      .select(CLIENT_NOTIFICATION_SELECT)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .eq("client_id", session.clientId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    unreadQuery,
  ]);

  if (listResult.error) {
    return jsonWithRouteTiming(
      { error: listResult.error.message },
      routeStartedAt,
      { status: 500 },
    );
  }
  if (unreadResult.error) {
    return jsonWithRouteTiming(
      { error: unreadResult.error.message },
      routeStartedAt,
      { status: 500 },
    );
  }

  const notifications = (
    (listResult.data as ClientNotificationRow[] | null) ?? []
  ).map(normalizeClientNotificationRow);

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
