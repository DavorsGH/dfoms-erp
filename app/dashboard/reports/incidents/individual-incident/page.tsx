import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { fetchIndividualIncidentReportData } from "../../operations-report-data";
import { IndividualIncidentReport } from "../../operations-reports";
import ReportsShell from "../../reports-shell";

export default async function IndividualIncidentReportPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchIndividualIncidentReportData(supabase);

  return (
    <ReportsShell sectionTitle="Individual Incident Report">
      <IndividualIncidentReport {...data} />
    </ReportsShell>
  );
}
