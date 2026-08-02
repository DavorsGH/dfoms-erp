import { redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalReportsNav from "./reports-nav";

export default async function LandlordPortalReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-[#0f2744]">Reports</h1>
      <p className="mb-6 text-sm text-slate-600">
        Portfolio reports for your properties — same calculations as staff Real
        Estate Reports. Export CSV or print each report.
      </p>
      <LandlordPortalReportsNav />
      {children}
    </div>
  );
}
