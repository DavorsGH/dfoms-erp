import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchRecurringIssueTrendReportData } from "../../operations-report-data";
import { RecurringIssueTrendReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function RecurringIssueTrendReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchRecurringIssueTrendReportData(supabase);

  return (
    <ReportsShell sectionTitle="Recurring Issue / Trend Report">
      <RecurringIssueTrendReport {...data} />
    </ReportsShell>
  );
}
