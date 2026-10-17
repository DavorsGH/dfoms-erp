import { cookies } from "next/headers";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { createClient } from "@/utils/supabase/server";
import { fetchDashboardPageData } from "@/app/dashboard/dashboard-page-data";
import { buildOwnerDashboardViewModel } from "@/app/dashboard/owner-dashboard-view-model";
import { attachDirectorScorecardToViewModel } from "@/app/dashboard/director-scorecard-load";
import { fetchScopedRawMaterialStock } from "@/app/dashboard/inventory/raw-material-bu-stock-utils";
import {
  enrichShareholdersWithCanDelete,
  fetchDividendDeclarationLines,
  fetchDividendDeclarations,
  fetchTenantShareholders,
} from "@/lib/finance/dividends-load";
import { createAdminClient } from "@/utils/supabase/admin";
import DirectorsBoard from "./directors-board";

export default async function DirectorsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    throw new Error("Unable to resolve workspace session.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const dividendBusinessUnitId =
    viewAllBusinessUnits || !activeBusinessUnitId ? null : activeBusinessUnitId;

  const [dashboardPageData, preloadedRawMaterialStock, shareholdersResult, declarationsResult] =
    await Promise.all([
      fetchDashboardPageData(supabase, tenantId, {
        activeBusinessUnitId,
        viewAllBusinessUnits,
      }),
      fetchScopedRawMaterialStock(supabase, tenantId, buScope),
      fetchTenantShareholders(supabase, tenantId),
      dividendBusinessUnitId
        ? fetchDividendDeclarations(supabase, tenantId, {
            businessUnitId: dividendBusinessUnitId,
          })
        : Promise.resolve({ rows: [], error: null }),
    ]);

  const linesResult = dividendBusinessUnitId
    ? await fetchDividendDeclarationLines(
        supabase,
        tenantId,
        declarationsResult.rows.map((row) => row.id),
      )
    : { rows: [], error: null };

  let viewModel = await buildOwnerDashboardViewModel(
    dashboardPageData,
    tenantId,
    {
      supabase,
      buScope,
      preloadedRawMaterialStock,
    },
  );

  viewModel = await attachDirectorScorecardToViewModel(
    supabase,
    tenantId,
    activeBusinessUnitId,
    buScope,
    viewModel,
    dashboardPageData,
  );

  const admin = createAdminClient();
  const shareholdersEnriched = await enrichShareholdersWithCanDelete(
    admin,
    tenantId,
    shareholdersResult.rows,
  );

  const dividendsFetchError =
    shareholdersResult.error ??
    shareholdersEnriched.error ??
    declarationsResult.error ??
    linesResult.error ??
    null;

  return (
    <DirectorsBoard
      data={viewModel}
      fetchError={dashboardPageData.fetchError}
      dividends={{
        tenantId,
        initialShareholders: shareholdersEnriched.rows,
        initialDeclarations: declarationsResult.rows,
        initialLines: linesResult.rows,
        fetchError: dividendsFetchError,
      }}
    />
  );
}
