import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchStockOnHandReportData } from "../../inventory-report-data";
import { StockOnHandReport } from "../../inventory-reports";
import ReportsShell from "../../reports-shell";

export default async function StockOnHandReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchStockOnHandReportData(supabase);

  return (
    <ReportsShell sectionTitle="Stock on Hand">
      <Suspense
        fallback={
          <p className="text-sm text-slate-600">Loading stock on hand report…</p>
        }
      >
        <StockOnHandReport {...data} />
      </Suspense>
    </ReportsShell>
  );
}
