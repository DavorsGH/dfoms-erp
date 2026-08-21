import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import { fetchComplaintsForLessee } from "@/utils/complaint-management";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  formatLesseeComplaintDate,
  formatLesseeComplaintRaisedBy,
  formatLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PortalIssuesView, {
  type PortalIssueItem,
} from "./portal-issues-view";

export default async function PortalIssuesPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const [maintenance, complaints] = await Promise.all([
    fetchMaintenanceRequestsForLessee(
      admin,
      session.tenantId,
      session.lesseeId,
    ),
    fetchComplaintsForLessee(admin, session.tenantId, session.lesseeId),
  ]);

  const repairs: PortalIssueItem[] = maintenance.rows
    .filter((row) => row.reportedBy === "tenant")
    .sort(
      (a, b) =>
        new Date(b.dateReported).getTime() - new Date(a.dateReported).getTime(),
    )
    .map((row) => ({
      id: `repair-${row.requestId}`,
      kind: "repair" as const,
      title: row.description,
      statusPrimary: formatMaintenanceStatus(row.status),
      statusSecondary: `Landlord ${formatMaintenanceLandlordApproval(row.landlordApprovalStatus)}`,
      raisedByLabel: null,
      dateLabel: formatMaintenanceDate(row.dateReported),
      detail: null,
      isLandlordRaised: false,
      costSelfFixLabel: row.tenantSelfFix
        ? `Self-fix ${formatMaintenanceMoney(row.proposedCostGhs)}`
        : null,
      hasPhotos:
        row.photoUrls.length > 0 || row.completionPhotoUrls.length > 0,
    }));

  const complaintItems: PortalIssueItem[] = [...complaints.rows]
    .sort(
      (a, b) =>
        new Date(b.dateReported).getTime() - new Date(a.dateReported).getTime(),
    )
    .map((row) => ({
    id: `complaint-${row.complaintId}`,
    kind: "complaint" as const,
    title: row.subject,
    statusPrimary: formatLesseeComplaintStatus(row.status),
    statusSecondary:
      row.raisedBy === "tenant" &&
      row.status === "resolved" &&
      !row.tenantAcknowledgedAt
        ? "Awaiting your acknowledgment"
        : row.tenantAcknowledgedAt
          ? "Acknowledged"
          : null,
    raisedByLabel: formatLesseeComplaintRaisedBy(row.raisedBy),
    dateLabel: formatLesseeComplaintDate(row.dateReported),
    detail: row.staffResponse,
    isLandlordRaised: row.raisedBy === "landlord",
    costSelfFixLabel: null,
    hasPhotos: false,
  }));

  const fetchError = maintenance.fetchError ?? complaints.fetchError;
  const hasAnyIssues = repairs.length > 0 || complaintItems.length > 0;

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>My Issues</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your repair requests and complaints in one place.
        </p>

        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : !hasAnyIssues ? (
          <p className="mt-4 text-sm text-slate-600">
            No issues yet. Submit a repair or complaint from the portal menu.
          </p>
        ) : (
          <PortalIssuesView
            complaints={complaintItems}
            repairs={repairs}
          />
        )}
      </section>
    </PortalShell>
  );
}
