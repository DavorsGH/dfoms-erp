import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import SecurityDepositReceiptActions from "@/app/dashboard/real-estate/security-deposit-receipt-actions";
import {
  SecurityDepositCollectionReceiptView,
  SecurityDepositResolutionReceiptView,
} from "@/app/dashboard/real-estate/security-deposit-receipt-view";
import {
  fetchPortalSecurityDepositReceipt,
  getPortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import { depositIsResolved } from "@/utils/security-deposit-receipt";
import PortalShell from "../../portal-shell";
import {
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
} from "../../portal-ui";

type PageProps = {
  params: Promise<{ depositId: string }>;
};

export default async function PortalSecurityDepositReceiptPage({
  params,
}: PageProps) {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const { depositId } = await params;
  const { receipt, error } = await fetchPortalSecurityDepositReceipt(
    session,
    depositId,
  );

  if (!receipt && !error) {
    return (
      <PortalShell fullName={session.fullName}>
        <NotificationTargetUnavailablePanel
          backHref="/portal/dashboard"
          backLabel="Back to dashboard"
        />
      </PortalShell>
    );
  }

  const showResolution = receipt ? depositIsResolved(receipt.status) : false;

  return (
    <PortalShell fullName={session.fullName}>
      <div className="space-y-4">
        <div className="receipt-no-print">
          <Link
            href="/portal/dashboard"
            className="text-sm text-[#0f2744] hover:underline"
          >
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
            Security deposit records
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Collection and resolution documents for your security deposit.
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
                  Resolution receipt will be available after your deposit is
                  returned, forfeited, or partially forfeited.
                </p>
              </section>
            )}
          </>
        ) : null}
      </div>
    </PortalShell>
  );
}
