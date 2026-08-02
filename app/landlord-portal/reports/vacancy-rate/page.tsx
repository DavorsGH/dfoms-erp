import { fetchVacancyOccupancyReportData } from "@/app/dashboard/reports/real-estate-report-data";
import { VacancyRateReport } from "@/app/dashboard/reports/real-estate-reports";
import ReportsShell from "@/app/dashboard/reports/reports-shell";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalReportDataScope,
  requireLandlordPortalReportSession,
} from "../portal-report-session";

export default async function LandlordPortalVacancyRateReportPage() {
  const session = await requireLandlordPortalReportSession();
  const admin = createAdminClient();
  const data = await fetchVacancyOccupancyReportData(
    admin,
    portalReportDataScope(session),
  );

  return (
    <ReportsShell sectionTitle="Vacancy Rate">
      <VacancyRateReport {...data} filterMode="portal" />
    </ReportsShell>
  );
}
