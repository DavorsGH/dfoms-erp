import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchAttendanceSummaryReportData } from "../../hr-report-data";
import { AttendanceSummaryReport } from "../../hr-reports";
import ReportsShell from "../../reports-shell";

export default async function AttendanceSummaryReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchAttendanceSummaryReportData(supabase);

  return (
    <ReportsShell sectionTitle="Attendance Summary">
      <AttendanceSummaryReport {...data} />
    </ReportsShell>
  );
}
