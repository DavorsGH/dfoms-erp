import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchCapitalContributionsReportData } from "../../finance-report-data";
import { CapitalContributionsReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function CapitalContributionsReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchCapitalContributionsReportData(supabase);

  return (
    <ReportsShell sectionTitle="Capital Contributions Summary">
      <CapitalContributionsReport {...data} />
    </ReportsShell>
  );
}
