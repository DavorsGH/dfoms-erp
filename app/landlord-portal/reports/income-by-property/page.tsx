import { fetchArrearsIncomeReportData } from "@/app/dashboard/reports/real-estate-report-data";
import { IncomeByPropertyReport } from "@/app/dashboard/reports/real-estate-reports";
import ReportsShell from "@/app/dashboard/reports/reports-shell";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalReportDataScope,
  requireLandlordPortalReportSession,
} from "../portal-report-session";

export default async function LandlordPortalIncomeByPropertyReportPage() {
  const session = await requireLandlordPortalReportSession();
  const admin = createAdminClient();
  const data = await fetchArrearsIncomeReportData(
    admin,
    portalReportDataScope(session),
  );

  return (
    <ReportsShell sectionTitle="Income by Property">
      <IncomeByPropertyReport {...data} filterMode="portal" />
    </ReportsShell>
  );
}
