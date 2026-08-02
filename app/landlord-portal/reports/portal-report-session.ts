import "server-only";

import { redirect } from "next/navigation";
import type { ReReportDataScope } from "@/app/dashboard/reports/real-estate-report-data";
import {
  getLandlordPortalSession,
  type LandlordPortalSession,
} from "@/utils/landlord-portal-auth";

/** Session gate for report pages. Pending approval is handled by reports layout. */
export async function requireLandlordPortalReportSession(): Promise<LandlordPortalSession> {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }
  return session;
}

export function portalReportDataScope(
  session: LandlordPortalSession,
): ReReportDataScope {
  return {
    kind: "tenant",
    tenantId: session.tenantId,
    landlordName: session.fullName,
  };
}
