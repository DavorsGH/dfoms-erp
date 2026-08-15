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

type PageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

export default async function LandlordPortalBillingPage({
  searchParams,
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

  const resolvedSearchParams = (await searchParams) ?? {};
  const tabParam = resolvedSearchParams.tab?.trim();
  const initialTab =
    tabParam === "payment" || tabParam === "sms" || tabParam === "billing"
      ? tabParam
      : "billing";

  const { data, error } = await fetchLandlordPortalBillingSnapshot(session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Billing settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          View your landlord plan status, buy prepaid SMS credits, and configure
          rent settlement for your workspace.
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
          billingCycle={data.billingCycle}
          pendingBillingCycle={data.pendingBillingCycle}
          currentPeriodStart={data.currentPeriodStart}
          currentPeriodEnd={data.currentPeriodEnd}
          activeUnitCount={data.activeUnitCount}
          monthlyUnitPriceGhs={data.monthlyUnitPriceGhs}
          annualUnitPriceGhs={data.annualUnitPriceGhs}
          nextChargeDate={data.nextChargeDate}
          nextChargeSummary={data.nextChargeSummary}
          smsCreditBalance={data.smsCreditBalance}
          smsCreditPacks={data.smsCreditPacks.map((pack) => ({
            packKey: pack.packKey,
            credits: pack.credits,
            priceGhs: pack.priceGhs,
          }))}
          billingEmail={data.billingEmail}
          paystackSubaccountStatus={data.paystackSubaccountStatus}
          showPaymentSettings={session.landlordType === "platform_only"}
          showBillingCycleControls={session.landlordType === "platform_only"}
          fetchError={error}
          initialTab={initialTab}
        />
      ) : null}
    </div>
  );
}
