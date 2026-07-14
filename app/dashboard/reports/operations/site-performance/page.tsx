import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchSitePerformanceReportData } from "../../operations-report-data";
import { SitePerformanceReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function SitePerformanceReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchSitePerformanceReportData(supabase);

  return (
    <ReportsShell sectionTitle="Site Performance Report">
      <SitePerformanceReport {...data} />
    </ReportsShell>
  );
}
