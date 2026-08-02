import { fetchArrearsIncomeReportData } from "@/app/dashboard/reports/real-estate-report-data";
import { ArrearsAgingReport } from "@/app/dashboard/reports/real-estate-reports";
import ReportsShell from "@/app/dashboard/reports/reports-shell";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalReportDataScope,
  requireLandlordPortalReportSession,
} from "../portal-report-session";

export default async function LandlordPortalArrearsAgingReportPage() {
  const session = await requireLandlordPortalReportSession();
  const admin = createAdminClient();
  const data = await fetchArrearsIncomeReportData(
    admin,
    portalReportDataScope(session),
  );

  return (
    <ReportsShell sectionTitle="Arrears Aging">
      <ArrearsAgingReport
        landlords={data.landlords}
        properties={data.properties}
        ledgerRows={data.ledgerRows}
        fetchError={data.fetchError}
        filterMode="portal"
      />
    </ReportsShell>
  );
}
