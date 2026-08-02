import { redirect } from "next/navigation";
import {
  fetchLandlordPortalWorkspaceProfile,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalWorkspaceForm from "./workspace-form";

export default async function LandlordPortalWorkspacePage() {
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

  const { data, error } = await fetchLandlordPortalWorkspaceProfile(session);

  return (
    <section className={portalSectionClassName}>
      <h1 className={portalSectionTitleClassName}>Workspace settings</h1>
      <p className="mt-1 text-sm text-slate-600">
        Update your landlord workspace profile. Billing and subscription are
        managed by Davors staff and are not available here.
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : null}

      {data ? (
        <LandlordPortalWorkspaceForm
          initialName={data.name}
          initialEmail={data.email}
          initialPhone={data.phone}
          initialAddress={data.address}
        />
      ) : null}
    </section>
  );
}
