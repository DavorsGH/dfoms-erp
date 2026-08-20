import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchPlatformSmsUsageReport } from "@/utils/platform-sms-usage";
import PlatformSmsUsageViewer from "./platform-sms-usage-viewer";

export default async function PlatformSmsUsagePage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  let report = null;
  let fetchError: string | null = null;

  try {
    const admin = createAdminClient();
    report = await fetchPlatformSmsUsageReport(admin);
  } catch (error) {
    fetchError =
      error instanceof Error
        ? error.message
        : "Unable to load platform SMS usage.";
  }

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Platform SMS Usage
      </h2>
      {report ? (
        <PlatformSmsUsageViewer report={report} fetchError={fetchError} />
      ) : (
        <PlatformSmsUsageViewer
          report={{
            generatedAt: new Date().toISOString(),
            totals: {
              totalSends: 0,
              allowanceSends: 0,
              paidSends: 0,
              allowanceCreditsGranted: 0,
              paidCreditsPurchased: 0,
            },
            periodBreakdown: [],
            perTenant: [],
            transactionalLog: {
              available: false,
              totalLogged: 0,
              ledgerSendCount: 0,
              discrepancy: 0,
              note: null,
            },
            hubtelBalance: {
              available: false,
              balance: null,
              currency: null,
              accountLabel: null,
              endpoint: null,
              error: null,
            },
            notes: [],
          }}
          fetchError={fetchError}
        />
      )}
    </>
  );
}
