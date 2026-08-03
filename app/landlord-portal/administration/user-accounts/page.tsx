import { redirect } from "next/navigation";
import {
  fetchLandlordPortalLesseeAccounts,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalLesseeAccounts from "./lessee-accounts";

export default async function LandlordPortalUserAccountsPage() {
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

  const { rows, error } = await fetchLandlordPortalLesseeAccounts(session);
  const canManageAccounts = session.landlordType === "platform_only";

  return (
    <section className={portalSectionClassName}>
      <h1 className={portalSectionTitleClassName}>User accounts</h1>
      <p className="mt-1 text-sm text-slate-600">
        {canManageAccounts
          ? "Lessee tenant-portal accounts for your properties. You can send invites, reset passwords, and deactivate or restore portal login without deleting tenant history. Staff role management is not available here."
          : "Lessee tenant-portal accounts for your properties. You can resend invites for lessees who have not accepted yet; deactivate and password reset are managed by Davors staff. Staff role management is not available here."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : (
        <div className="mt-4">
          <LandlordPortalLesseeAccounts
            initialRows={rows}
            fetchError={null}
            canManageAccounts={canManageAccounts}
          />
        </div>
      )}
    </section>
  );
}
