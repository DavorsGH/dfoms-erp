import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import {
  getCurrentAuthUid,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Display-only dashboard widget aggregates.
 * Raw ledger register rows are never returned or cached client-side.
 */
export async function GET() {
  const tenantId = await getCurrentUserTenantId();
  const authUid = await getCurrentAuthUid();

  if (!tenantId || !authUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const dashboardPageData = await fetchDashboardPageData(supabase, tenantId);
  const viewModel = buildOwnerDashboardViewModel(dashboardPageData, tenantId);

  return NextResponse.json({
    tenantId,
    authUid,
    cachedAt: new Date().toISOString(),
    fetchError: dashboardPageData.fetchError,
    viewModel,
  });
}
