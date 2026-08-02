import { createAdminClient } from "@/utils/supabase/admin";
import { fetchVacancyOccupancyReportData } from "../../real-estate-report-data";
import { OccupancyReport } from "../../real-estate-reports";
import ReportsShell from "../../reports-shell";

export default async function OccupancyReportPage() {
  const admin = createAdminClient();
  const data = await fetchVacancyOccupancyReportData(admin);

  return (
    <ReportsShell sectionTitle="Occupancy">
      <OccupancyReport {...data} />
    </ReportsShell>
  );
}
