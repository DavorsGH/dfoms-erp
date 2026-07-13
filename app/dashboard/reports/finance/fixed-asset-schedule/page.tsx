import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchFixedAssetScheduleReportData } from "../../finance-report-data";
import { FixedAssetScheduleReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function FixedAssetScheduleReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchFixedAssetScheduleReportData(supabase);

  return (
    <ReportsShell sectionTitle="Fixed Asset & Depreciation Schedule">
      <FixedAssetScheduleReport {...data} />
    </ReportsShell>
  );
}
