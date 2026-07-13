import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchMonthlyPlReportData } from "../../finance-report-data";
import { MonthlyPlReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyPlReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchMonthlyPlReportData(supabase);

  return (
    <ReportsShell sectionTitle="Monthly P&L Statement">
      <MonthlyPlReport {...data} />
    </ReportsShell>
  );
}
