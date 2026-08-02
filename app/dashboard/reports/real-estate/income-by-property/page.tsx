import { createAdminClient } from "@/utils/supabase/admin";
import { fetchArrearsIncomeReportData } from "../../real-estate-report-data";
import { IncomeByPropertyReport } from "../../real-estate-reports";
import ReportsShell from "../../reports-shell";

export default async function IncomeByPropertyReportPage() {
  const admin = createAdminClient();
  const data = await fetchArrearsIncomeReportData(admin);

  return (
    <ReportsShell sectionTitle="Income by Property">
      <IncomeByPropertyReport {...data} />
    </ReportsShell>
  );
}