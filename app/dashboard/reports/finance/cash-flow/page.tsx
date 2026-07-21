import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { fetchCashFlowReportData } from "../../finance-report-data";
import { CashFlowStatementReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function CashFlowReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    throw new Error("Unable to resolve the current workspace.");
  }

  const data = await fetchCashFlowReportData(supabase, tenantId);

  return (
    <ReportsShell sectionTitle="Cash Flow Statement">
      <CashFlowStatementReport {...data} />
    </ReportsShell>
  );
}
