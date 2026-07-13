import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchCashFlowReportData } from "../../finance-report-data";
import { CashFlowStatementReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function CashFlowReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchCashFlowReportData(supabase);

  return (
    <ReportsShell sectionTitle="Cash Flow Statement">
      <CashFlowStatementReport {...data} />
    </ReportsShell>
  );
}
