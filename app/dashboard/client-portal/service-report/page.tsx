import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserClientId } from "@/utils/dashboard-auth";
import { fetchClientServiceReportData } from "../../reports/operations-report-data";
import { MonthlyClientServiceReport } from "../../reports/operations-reports";
import ClientPortalShell from "../client-portal-shell";

export default async function ClientPortalServiceReportPage() {
  const clientId = await getCurrentUserClientId();

  if (!clientId) {
    return (
      <ClientPortalShell sectionTitle="My Service Report">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to a customer record.
        </div>
      </ClientPortalShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const data = await fetchClientServiceReportData(supabase);

  return (
    <ClientPortalShell sectionTitle="My Service Report">
      <MonthlyClientServiceReport {...data} scopedClientId={clientId} />
    </ClientPortalShell>
  );
}
