import { redirect } from "next/navigation";
import {
  fetchLandlordPortalBillingSnapshot,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";
import LandlordPortalBillingSettings from "./billing-settings";

export default async function LandlordPortalBillingPage() {
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

  const { data, error } = await fetchLandlordPortalBillingSnapshot(session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Billing settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          View your landlord plan status and buy prepaid SMS credits for this
          workspace.
        </p>
      </div>

      {error && !data ? (
        <div className={portalErrorBannerClassName}>{error}</div>
      ) : null}

      {data ? (
        <LandlordPortalBillingSettings
          subscriptionTier={data.subscriptionTier}
          subscriptionStatus={data.subscriptionStatus}
          trialEndsAt={data.trialEndsAt}
          smsCreditBalance={data.smsCreditBalance}
          smsCreditPacks={data.smsCreditPacks.map((pack) => ({
            packKey: pack.packKey,
            credits: pack.credits,
            priceGhs: pack.priceGhs,
          }))}
          billingEmail={data.billingEmail}
          fetchError={error}
        />
      ) : null}
    </div>
  );
}
