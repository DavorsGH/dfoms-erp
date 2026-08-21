import { redirect } from "next/navigation";
import {
  fetchLandlordPortalMaintenance,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  formatMaintenanceDate,
  formatMaintenanceMoney,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordMaintenanceList, {
  type LandlordMaintenanceListItem,
} from "./landlord-maintenance-list";

export default async function LandlordPortalMaintenancePage() {
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

  const { rows, error } = await fetchLandlordPortalMaintenance(session);
  const canAct = session.landlordType === "platform_only";

  const listItems: LandlordMaintenanceListItem[] = rows.map((row) => ({
    requestId: row.requestId,
    description: row.description,
    dateLabel: formatMaintenanceDate(row.dateReported),
    statusLabel: row.statusLabel,
    landlordApprovalLabel: row.landlordApprovalLabel,
    costSelfFixLabel: row.tenantSelfFix
      ? `Self-fix ${formatMaintenanceMoney(row.proposedCostGhs)}`
      : null,
    lesseeName: row.lesseeName,
    unitLabel: row.unitLabel,
    tenantSelfFix: row.tenantSelfFix,
    proposedCostGhs: row.proposedCostGhs,
    status: row.status,
    landlordApprovalStatus: row.landlordApprovalStatus,
    photoUrls: row.photoUrls,
    completionPhotoUrls: row.completionPhotoUrls,
    hasPendingApproval: row.landlordApprovalStatus === "pending",
    hasPhotos: row.photoUrls.length > 0 || row.completionPhotoUrls.length > 0,
  }));

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Maintenance requests</h2>
      <p className="mt-1 text-sm text-slate-600">
        {canAct
          ? "Review and approve or reject repair requests for your properties."
          : "View-only list of repair requests and approval status. Davors manages approvals for your account."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : listItems.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No maintenance requests yet.
        </p>
      ) : (
        <LandlordMaintenanceList
          rows={listItems}
          canAct={canAct}
          tenantId={session.tenantId}
        />
      )}
    </section>
  );
}
