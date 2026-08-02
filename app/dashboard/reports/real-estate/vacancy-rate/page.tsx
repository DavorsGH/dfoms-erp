import { createAdminClient } from "@/utils/supabase/admin";
import { fetchVacancyOccupancyReportData } from "../../real-estate-report-data";
import { VacancyRateReport } from "../../real-estate-reports";
import ReportsShell from "../../reports-shell";

export default async function VacancyRateReportPage() {
  const admin = createAdminClient();
  const data = await fetchVacancyOccupancyReportData(admin);

  return (
    <ReportsShell sectionTitle="Vacancy Rate">
      <VacancyRateReport {...data} />
    </ReportsShell>
  );
}
