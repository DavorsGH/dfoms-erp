import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchEscalatedIncidentsReportData } from "../../operations-report-data";
import { EscalatedIncidentsReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function EscalatedIncidentsReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchEscalatedIncidentsReportData(supabase);

  return (
    <ReportsShell sectionTitle="Escalated Incidents Report">
      <EscalatedIncidentsReport {...data} />
    </ReportsShell>
  );
}
