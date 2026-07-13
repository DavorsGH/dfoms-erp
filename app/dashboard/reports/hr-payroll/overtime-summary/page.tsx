import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchOvertimeSummaryReportData } from "../../hr-report-data";
import { OvertimeSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function OvertimeSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchOvertimeSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Overtime Summary">
      <OvertimeSummaryReport {...data} />
    </ReportsShell>
  );
}
