import { redirect } from "next/navigation";
import {
  fetchLandlordPortalTerminations,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatLeaseDate } from "@/app/dashboard/real-estate/leases-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordTerminationsList, {
  type LandlordTerminationListItem,
} from "./landlord-terminations-list";

export default async function LandlordPortalTerminationsPage() {
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

  const { rows, error } = await fetchLandlordPortalTerminations(session);
  const canAct = session.landlordType === "platform_only";

  const listItems: LandlordTerminationListItem[] = rows.map((row) => ({
    leaseId: row.leaseId,
    lesseeName: row.lesseeName,
    unitLabel: row.unitLabel,
    endDateLabel: formatLeaseDate(row.endDate),
    statusLabel: row.statusLabel,
    reason: row.reason,
    canReview: canAct && row.requestStatus === "pending_staff_approval",
  }));

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Termination requests</h2>
      <p className="mt-1 text-sm text-slate-600">
        {canAct
          ? "Approve or reject early termination requests for your leases."
          : "View-only list of early termination requests. Davors manages approvals for your account."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : listItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No termination requests yet.
        </p>
      ) : (
        <LandlordTerminationsList rows={listItems} />
      )}
    </section>
  );
}
