import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchProductionHistoryReportData } from "../../inventory-report-data";
import { ProductionHistoryReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function ProductionHistoryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchProductionHistoryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Production History">
      <ProductionHistoryReport {...data} />
    </ReportsShell>
  );
}
