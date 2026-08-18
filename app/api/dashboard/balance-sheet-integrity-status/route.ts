import { NextResponse } from "next/server";
import {
  getCurrentAuthUid,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import {
  fetchTenantBalanceSheetIntegrityStatus,
  type TenantBalanceSheetIntegrityStatus,
} from "@/utils/tenant-balance-sheet-integrity-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
