import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import { fetchTenantBalanceSheetIntegrityStatus } from "@/utils/tenant-balance-sheet-integrity-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Display-only dashboard widget aggregates.
 * Raw ledger register rows are never returned or cached client-side.
 */
export async function GET() {
  const [tenantId, authUid, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getCurrentAuthUid(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const dashboardPageData = await fetchDashboardPageData(supabase, tenantId, {
    activeBusinessUnitId,
    viewAllBusinessUnits,
  });
  const [viewModelBase, balanceSheetIntegrity] = await Promise.all([
    Promise.resolve(buildOwnerDashboardViewModel(dashboardPageData, tenantId)),
    fetchTenantBalanceSheetIntegrityStatus(tenantId),
  ]);
  const viewModel = {
    ...viewModelBase,
    balanceSheetIntegrity,
  };

  return NextResponse.json({
    tenantId,
    authUid,
    cachedAt: new Date().toISOString(),
    fetchError: dashboardPageData.fetchError,
    viewModel,
  });
}
