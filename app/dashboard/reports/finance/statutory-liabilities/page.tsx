import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchStatutoryLiabilitiesReportData } from "../../finance-report-data";
import { StatutoryLiabilitiesReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function StatutoryLiabilitiesReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchStatutoryLiabilitiesReportData(supabase);

  return (
    <ReportsShell sectionTitle="Statutory Liabilities Report">
      <StatutoryLiabilitiesReport {...data} />
    </ReportsShell>
  );
}
