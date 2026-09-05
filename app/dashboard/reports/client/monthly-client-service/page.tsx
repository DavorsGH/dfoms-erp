import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchClientServiceReportData } from "../../operations-report-data";
import { MonthlyClientServiceReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyClientServiceReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const data = await fetchClientServiceReportData(supabase, { buScope });

  return (
    <ReportsShell sectionTitle="Monthly Customer Service Report">
      <MonthlyClientServiceReport {...data} />
    </ReportsShell>
  );
}
