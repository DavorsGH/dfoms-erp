import { fetchVacancyOccupancyReportData } from "@/app/dashboard/reports/real-estate-report-data";
import { OccupancyReport } from "@/app/dashboard/reports/real-estate-reports";
import ReportsShell from "@/app/dashboard/reports/reports-shell";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalReportDataScope,
  requireLandlordPortalReportSession,
} from "../portal-report-session";

export default async function LandlordPortalOccupancyReportPage() {
  const session = await requireLandlordPortalReportSession();
  const admin = createAdminClient();
  const data = await fetchVacancyOccupancyReportData(
    admin,
    portalReportDataScope(session),
  );

  return (
    <ReportsShell sectionTitle="Occupancy">
      <OccupancyReport {...data} filterMode="portal" />
    </ReportsShell>
  );
}
