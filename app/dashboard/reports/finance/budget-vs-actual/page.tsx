import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchBudgetVsActualReportData } from "../../finance-report-data";
import { BudgetVsActualReport } from "../../finance-reports";

export default async function BudgetVsActualReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchBudgetVsActualReportData(supabase);

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/dashboard/finance/budget"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
        >
          Back to budget
        </Link>
        <h2 className="text-xl font-semibold text-[#0f2744]">
          Budget vs Actual
        </h2>
      </div>
      <Suspense
        fallback={
          <p className="text-sm text-slate-600">Loading Budget vs Actual…</p>
        }
      >
        <BudgetVsActualReport {...data} />
      </Suspense>
    </div>
  );
}
