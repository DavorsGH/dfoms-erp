import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchMonthlyIncidentSummaryReportData } from "../../operations-report-data";
import { MonthlyIncidentSummaryReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyIncidentSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchMonthlyIncidentSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Monthly Incident Summary">
      <MonthlyIncidentSummaryReport {...data} />
    </ReportsShell>
  );
}
