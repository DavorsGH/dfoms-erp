import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchInternalConsumptionReportData } from "../../inventory-report-data";
import { InternalConsumptionReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function InternalConsumptionReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchInternalConsumptionReportData(supabase);

  return (
    <ReportsShell sectionTitle="Internal Consumption">
      <InternalConsumptionReport {...data} />
    </ReportsShell>
  );
}
