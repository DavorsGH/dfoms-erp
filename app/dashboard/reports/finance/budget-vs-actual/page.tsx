import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchBudgetVsActualReportData } from "../../finance-report-data";
import { BudgetVsActualReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function BudgetVsActualReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchBudgetVsActualReportData(supabase);

  return (
    <ReportsShell sectionTitle="Budget vs Actual">
      <BudgetVsActualReport {...data} />
    </ReportsShell>
  );
}
