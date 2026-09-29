import { NextResponse } from "next/server";
import { DFOMS_ROUTE_TIMING_HEADER } from "@/lib/notification-badge-api";

export function jsonWithRouteTiming<T>(
  body: T,
  startedAtMs: number,
  init?: ResponseInit,
): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set(
    DFOMS_ROUTE_TIMING_HEADER,
    String(Math.max(0, Date.now() - startedAtMs)),
  );
  return response;
}
