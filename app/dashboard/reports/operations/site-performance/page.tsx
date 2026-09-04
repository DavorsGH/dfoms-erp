import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchSitePerformanceReportData } from "../../operations-report-data";
import { SitePerformanceReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function SitePerformanceReportPage() {
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
  const data = await fetchSitePerformanceReportData(
    supabase,
    tenantId,
    buScope,
  );

  return (
    <ReportsShell sectionTitle="Site Performance Report">
      <SitePerformanceReport {...data} />
    </ReportsShell>
  );
}
