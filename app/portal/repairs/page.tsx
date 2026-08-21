import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PortalRepairForm from "./repair-form";
import PortalRepairsList, {
  type PortalRepairListItem,
} from "./portal-repairs-list";

export default async function PortalRepairsPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const { rows, fetchError } = await fetchMaintenanceRequestsForLessee(
    admin,
    session.tenantId,
    session.lesseeId,
  );

  const mine = rows.filter((row) => row.reportedBy === "tenant");

  const listItems: PortalRepairListItem[] = mine.map((row) => ({
    requestId: row.requestId,
    description: row.description,
    dateLabel: formatMaintenanceDate(row.dateReported),
    statusLabel: formatMaintenanceStatus(row.status),
    landlordApprovalLabel: formatMaintenanceLandlordApproval(
      row.landlordApprovalStatus,
    ),
    costSelfFixLabel: row.tenantSelfFix
      ? `Self-fix ${formatMaintenanceMoney(row.proposedCostGhs)}`
      : null,
    hasPhotos:
      row.photoUrls.length > 0 || row.completionPhotoUrls.length > 0,
  }));

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <PortalRepairForm />

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Your repair requests</h2>
        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : listItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No repair requests yet.</p>
        ) : (
          <PortalRepairsList rows={listItems} />
        )}
      </section>
    </PortalShell>
  );
}
