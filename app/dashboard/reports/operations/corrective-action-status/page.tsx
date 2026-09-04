import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchCorrectiveActionStatusReportData } from "../../operations-report-data";
import { CorrectiveActionStatusReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function CorrectiveActionStatusReportPage() {
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
  const data = await fetchCorrectiveActionStatusReportData(supabase, buScope);

  return (
    <ReportsShell sectionTitle="Corrective Action Status">
      <CorrectiveActionStatusReport {...data} />
    </ReportsShell>
  );
}
