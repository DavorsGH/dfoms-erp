import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import {
  fetchLandlordPortalLesseeDetail,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import LandlordPortalTenantEditForm from "../tenant-edit-form";

type PageProps = {
  params: Promise<{ lesseeId: string }>;
};

export default async function LandlordPortalTenantDetailPage({
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

  const canEdit = session.landlordType === "platform_only";
  const { lesseeId } = await params;
  const { detail, error } = await fetchLandlordPortalLesseeDetail(
    session,
    lesseeId,
  );

  if (!detail && !error) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/real-estate/tenants"
        backLabel="Back to tenants"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord-portal/real-estate/tenants"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to tenants
        </Link>
        <h1 className={`mt-2 ${portalSectionTitleClassName}`}>
          {detail?.fullName ?? "Tenant"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {canEdit
            ? "Update tenant contact details. Portal login is managed separately under Administration → User Accounts."
            : "View tenant contact details. Contact Davors staff to request changes."}
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {detail ? (
        <LandlordPortalTenantEditForm detail={detail} canEdit={canEdit} />
      ) : null}
    </div>
  );
}
