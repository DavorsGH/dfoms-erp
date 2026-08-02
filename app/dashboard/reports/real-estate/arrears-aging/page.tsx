import { createAdminClient } from "@/utils/supabase/admin";
import { fetchArrearsIncomeReportData } from "../../real-estate-report-data";
import { ArrearsAgingReport } from "../../real-estate-reports";
import ReportsShell from "../../reports-shell";

export default async function ArrearsAgingReportPage() {
  const admin = createAdminClient();
  const data = await fetchArrearsIncomeReportData(admin);

  return (
    <ReportsShell sectionTitle="Arrears Aging">
      <ArrearsAgingReport
        landlords={data.landlords}
        properties={data.properties}
        ledgerRows={data.ledgerRows}
        fetchError={data.fetchError}
      />
    </ReportsShell>
  );
}
