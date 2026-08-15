import { NextResponse } from "next/server";
import {
  getLayoutPerfCounters,
  resetLayoutPerfCounters,
} from "@/utils/dashboard-auth";
import { loadDashboardShellData } from "@/utils/dashboard-shell-data";

function isAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return false;
  }
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${cronSecret}`;
}

/**
 * Staging perf probe: runs dashboard layout shell queries and returns timings.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  resetLayoutPerfCounters();
  const startedAt = Date.now();

  await loadDashboardShellData();

  const layoutMs = Date.now() - startedAt;
  const counters = getLayoutPerfCounters();

  return NextResponse.json({
    layoutMs,
    layoutAuthCalls: counters.authCalls,
    layoutDbCalls: counters.dbCalls,
    layoutSkippedAuthCalls: counters.skippedAuthCalls,
    layoutSkippedDbCalls: counters.skippedDbCalls,
  });
}
