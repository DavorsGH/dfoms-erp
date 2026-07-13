import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchLoanRegisterSummaryReportData } from "../../hr-report-data";
import { LoanRegisterSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function LoanRegisterSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchLoanRegisterSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Loan Register Summary">
      <LoanRegisterSummaryReport {...data} />
    </ReportsShell>
  );
}
