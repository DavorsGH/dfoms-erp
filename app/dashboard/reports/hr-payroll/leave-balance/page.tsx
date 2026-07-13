import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchLeaveBalanceReportData } from "../../hr-report-data";
import { LeaveBalanceReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function LeaveBalanceReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchLeaveBalanceReportData(supabase);

  return (
    <ReportsShell sectionTitle="Leave Balance Report">
      <LeaveBalanceReport {...data} />
    </ReportsShell>
  );
}
