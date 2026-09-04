import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchInternalConsumptionReportData } from "../../inventory-report-data";
import { InternalConsumptionReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function InternalConsumptionReportPage() {
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
  const data = await fetchInternalConsumptionReportData(supabase, buScope);

  return (
    <ReportsShell sectionTitle="Internal Consumption">
      <InternalConsumptionReport {...data} />
    </ReportsShell>
  );
}
