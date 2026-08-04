import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import SecurityDepositReceiptActions from "@/app/dashboard/real-estate/security-deposit-receipt-actions";
import {
  SecurityDepositCollectionReceiptView,
  SecurityDepositResolutionReceiptView,
} from "@/app/dashboard/real-estate/security-deposit-receipt-view";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchSecurityDepositReceipt, depositIsResolved } from "@/utils/security-deposit-receipt";
import {
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";

type PageProps = {
  params: Promise<{ depositId: string }>;
};

export default async function LandlordPortalSecurityDepositReceiptPage({
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

  const { depositId } = await params;
  const admin = createAdminClient();
  const { receipt, error } = await fetchSecurityDepositReceipt(admin, {
    tenantId: session.tenantId,
    depositId,
  });

  if (!receipt && !error) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/finance/rent-ledger"
        backLabel="Back to finance"
      />
    );
  }

  const showResolution = receipt ? depositIsResolved(receipt.status) : false;

  return (
    <div className="space-y-4">
      <div className="receipt-no-print">
        <Link
          href="/landlord-portal/finance/rent-ledger"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Finance
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
          Security deposit records
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Collection and resolution documents for this deposit.
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {receipt ? (
        <>
          <div className="receipt-no-print flex flex-wrap gap-2">
            <SecurityDepositReceiptActions
              receipt={receipt}
              kind="collection"
              secondaryButtonClassName={portalSecondaryButtonClassName}
              primaryButtonClassName={portalPrimaryButtonClassName}
            />
            {showResolution ? (
              <SecurityDepositReceiptActions
                receipt={receipt}
                kind="resolution"
                secondaryButtonClassName={portalSecondaryButtonClassName}
                primaryButtonClassName={portalPrimaryButtonClassName}
              />
            ) : null}
          </div>

          <SecurityDepositCollectionReceiptView receipt={receipt} />

          {showResolution ? (
            <SecurityDepositResolutionReceiptView receipt={receipt} />
          ) : (
            <section className={portalSectionClassName}>
              <p className="text-sm text-slate-600">
                Resolution receipt will be available after the deposit is resolved.
              </p>
            </section>
          )}
        </>
      ) : null}
    </div>
  );
}
