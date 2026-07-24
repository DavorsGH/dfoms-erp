import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchClientServiceReportData } from "../../operations-report-data";
import { MonthlyClientServiceReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyClientServiceReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchClientServiceReportData(supabase);

  return (
    <ReportsShell sectionTitle="Monthly Customer Service Report">
      <MonthlyClientServiceReport {...data} />
    </ReportsShell>
  );
}
