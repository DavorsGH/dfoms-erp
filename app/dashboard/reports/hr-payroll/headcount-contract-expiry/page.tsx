import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchHeadcountContractExpiryReportData } from "../../hr-report-data";
import { HeadcountContractExpiryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function HeadcountContractExpiryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchHeadcountContractExpiryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Headcount & Contract Expiry">
      <HeadcountContractExpiryReport {...data} />
    </ReportsShell>
  );
}
