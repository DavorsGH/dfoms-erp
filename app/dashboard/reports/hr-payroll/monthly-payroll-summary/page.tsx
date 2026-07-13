import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchMonthlyPayrollSummaryReportData } from "../../hr-report-data";
import { MonthlyPayrollSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function MonthlyPayrollSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchMonthlyPayrollSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Monthly Payroll Summary">
      <MonthlyPayrollSummaryReport {...data} />
    </ReportsShell>
  );
}
