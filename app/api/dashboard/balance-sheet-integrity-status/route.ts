import { NextResponse } from "next/server";
import {
  getCurrentAuthUid,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import {
  fetchTenantBalanceSheetIntegrityStatus,
  runLiveTenantBalanceSheetIntegrityCheck,
  type TenantBalanceSheetIntegrityStatus,
} from "@/utils/tenant-balance-sheet-integrity-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-auth-uid throttle for on-demand live checks (ephemeral, in-process). */
const LIVE_CHECK_MIN_INTERVAL_MS = 5000;
const lastLiveCheckAtByAuthUid = new Map<string, number>();

function isLiveCheckRateLimited(authUid: string): boolean {
  const now = Date.now();
  const last = lastLiveCheckAtByAuthUid.get(authUid) ?? 0;
  if (now - last < LIVE_CHECK_MIN_INTERVAL_MS) {
    return true;
  }
  lastLiveCheckAtByAuthUid.set(authUid, now);
  return false;
}

/**
 * Tenant-scoped read of the latest nightly balance-sheet-integrity cron row.
 * tenantId always comes from the authenticated session — never from query/body.
 */
export async function GET(): Promise<
  NextResponse<TenantBalanceSheetIntegrityStatus | { error: string }>
> {
  const tenantId = await getCurrentUserTenantId();
  const authUid = await getCurrentAuthUid();

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = await fetchTenantBalanceSheetIntegrityStatus(tenantId);
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load integrity status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * On-demand live audit for the session tenant only.
 * Does not write system_event_log — ephemeral refresh for the current page view.
 */
export async function POST(): Promise<
  NextResponse<TenantBalanceSheetIntegrityStatus | { error: string }>
> {
  const tenantId = await getCurrentUserTenantId();
  const authUid = await getCurrentAuthUid();

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isLiveCheckRateLimited(authUid)) {
    return NextResponse.json(
      { error: "Please wait a few seconds before checking again." },
      { status: 429 },
    );
  }

  try {
    const status = await runLiveTenantBalanceSheetIntegrityCheck(tenantId);
    return NextResponse.json(status);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to run balance sheet check";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
