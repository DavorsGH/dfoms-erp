import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchArAgingReportData } from "../../finance-report-data";
import { ArAgingReport } from "../../finance-reports";
import ReportsShell from "../../reports-shell";

export default async function ArAgingReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchArAgingReportData(supabase);

  return (
    <ReportsShell sectionTitle="Accounts Receivable Aging">
      <ArAgingReport {...data} />
    </ReportsShell>
  );
}
