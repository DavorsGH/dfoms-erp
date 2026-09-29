import { NextResponse } from "next/server";
import {
  DFOMS_ROUTE_DB_TIMING_HEADER,
  DFOMS_ROUTE_SETUP_TIMING_HEADER,
  DFOMS_ROUTE_TIMING_HEADER,
  DFOMS_ROUTE_TRUST_TIMING_HEADER,
} from "@/lib/notification-badge-api";
import { stripLeakedMiddlewareHeaders } from "@/lib/middleware-proxy-headers";

export type BadgeRouteSegmentMs = {
  setupMs: number;
  trustMs: number;
  dbMs: number;
};

export function jsonWithRouteTiming<T>(
  body: T,
  startedAtMs: number,
  init?: ResponseInit,
  badgeSegments?: BadgeRouteSegmentMs,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set(
    DFOMS_ROUTE_TIMING_HEADER,
    String(Math.max(0, Date.now() - startedAtMs)),
  );
  if (badgeSegments) {
    response.headers.set(
      DFOMS_ROUTE_SETUP_TIMING_HEADER,
      String(Math.max(0, badgeSegments.setupMs)),
    );
    response.headers.set(
      DFOMS_ROUTE_TRUST_TIMING_HEADER,
      String(Math.max(0, badgeSegments.trustMs)),
    );
    response.headers.set(
      DFOMS_ROUTE_DB_TIMING_HEADER,
      String(Math.max(0, badgeSegments.dbMs)),
    );
  }
  return stripLeakedMiddlewareHeaders(response);
}
