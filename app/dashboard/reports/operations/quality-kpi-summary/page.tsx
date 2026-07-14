import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchQualityKpiSummaryReportData } from "../../operations-report-data";
import { QualityKpiSummaryReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function QualityKpiSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchQualityKpiSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Quality KPI Summary">
      <QualityKpiSummaryReport {...data} />
    </ReportsShell>
  );
}
