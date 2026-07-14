import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchCorrectiveActionStatusReportData } from "../../operations-report-data";
import { CorrectiveActionStatusReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function CorrectiveActionStatusReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchCorrectiveActionStatusReportData(supabase);

  return (
    <ReportsShell sectionTitle="Corrective Action Status">
      <CorrectiveActionStatusReport {...data} />
    </ReportsShell>
  );
}
