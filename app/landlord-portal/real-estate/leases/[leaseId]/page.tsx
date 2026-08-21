import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLeaseDetail } from "@/utils/lease-management";
import { fetchLeaseChargeSettings } from "@/utils/lease-charge-settings";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import LandlordLeaseDetailView from "../landlord-lease-detail-view";

type PageProps = {
  params: Promise<{ leaseId: string }>;
};

export default async function LandlordPortalLeaseDetailPage({
  params,
}: PageProps) {
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

  const { leaseId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchLeaseDetail(
    admin,
    session.tenantId,
    leaseId,
  );
  const { settings: chargeSettings } = detail
    ? await fetchLeaseChargeSettings(admin, detail.leaseId)
    : { settings: [] };

  if (!detail && !fetchError) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/real-estate/leases"
        backLabel="Back to leases"
      />
    );
  }

  if (!detail) {
    return (
      <LandlordLeaseDetailView
        detail={null}
        chargeSettings={[]}
        canManage={session.landlordType === "platform_only"}
        fetchError={fetchError}
      />
    );
  }

  return (
    <LandlordLeaseDetailView
      detail={detail}
      chargeSettings={chargeSettings}
      canManage={session.landlordType === "platform_only"}
      fetchError={fetchError}
    />
  );
}
