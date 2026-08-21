import { redirect } from "next/navigation";
import {
  fetchLandlordPortalComplaints,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatLesseeComplaintDate } from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordComplaintsList, {
  type LandlordComplaintListItem,
} from "./landlord-complaints-list";

export default async function LandlordPortalComplaintsPage() {
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

  const { rows, error } = await fetchLandlordPortalComplaints(session);
  const canAct = session.landlordType === "platform_only";

  const listItems: LandlordComplaintListItem[] = rows.map((row) => ({
    complaintId: row.complaintId,
    subject: row.subject,
    description: row.description,
    status: row.status,
    statusLabel: row.statusLabel,
    raisedBy: row.raisedBy,
    raisedByLabel: row.raisedByLabel,
    staffResponse: row.staffResponse,
    dateLabel: formatLesseeComplaintDate(row.dateReported),
    lesseeName: row.lesseeName,
    unitLabel: row.unitLabel,
    isOpen: row.status === "submitted" || row.status === "in_progress",
  }));

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Complaints</h2>
      <p className="mt-1 text-sm text-slate-600">
        {canAct
          ? "Respond to tenant complaints, file complaints about tenants from a lease, and mark items resolved."
          : "View-only list of complaints and current status. Davors manages responses for your account."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : listItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No complaints yet.</p>
      ) : (
        <LandlordComplaintsList rows={listItems} canAct={canAct} />
      )}
    </section>
  );
}
