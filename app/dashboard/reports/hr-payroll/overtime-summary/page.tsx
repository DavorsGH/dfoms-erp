import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchOvertimeSummaryReportData } from "../../hr-report-data";
import { OvertimeSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function OvertimeSummaryReportPage() {
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
  const data = await fetchOvertimeSummaryReportData(
    supabase,
    tenantId,
    buScope,
  );

  return (
    <ReportsShell sectionTitle="Overtime Summary">
      <OvertimeSummaryReport {...data} />
    </ReportsShell>
  );
}
