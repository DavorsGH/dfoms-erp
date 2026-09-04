import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchStockOnHandReportData } from "../../inventory-report-data";
import { StockOnHandReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function StockOnHandReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  if (!tenantId) {
    redirect("/login");
  }
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const data = await fetchStockOnHandReportData(supabase, tenantId, buScope);

  return (
    <ReportsShell sectionTitle="Stock on Hand">
      <Suspense
        fallback={
          <p className="text-sm text-slate-600">Loading stock on hand report…</p>
        }
      >
        <StockOnHandReport {...data} />
      </Suspense>
    </ReportsShell>
  );
}
