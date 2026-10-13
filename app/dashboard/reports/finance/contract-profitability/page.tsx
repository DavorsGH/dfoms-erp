import { Suspense } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchContractProfitabilityReportData } from "../../finance-report-data";
import { ContractProfitabilityReport } from "../../finance-reports";

export default async function ContractProfitabilityReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchContractProfitabilityReportData(supabase);

  return (
    <div>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Contract Profitability
      </h2>
      <Suspense
        fallback={
          <p className="text-sm text-slate-600">Loading Contract Profitability…</p>
        }
      >
        <ContractProfitabilityReport {...data} />
      </Suspense>
    </div>
  );
}
