import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import RentPaymentReceiptActions from "@/app/dashboard/real-estate/rent-payment-receipt-actions";
import RentPaymentReceiptView from "@/app/dashboard/real-estate/rent-payment-receipt-view";
import {
  fetchPortalRentPaymentReceipt,
  getPortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import PortalShell from "../../portal-shell";
import {
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../../portal-ui";

type PageProps = {
  params: Promise<{ entryId: string }>;
};

export default async function PortalPaymentReceiptPage({ params }: PageProps) {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const { entryId } = await params;
  const { receipt, error } = await fetchPortalRentPaymentReceipt(session, entryId);

  if (!receipt && !error) {
    return (
      <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
        <NotificationTargetUnavailablePanel
          backHref="/portal/payments"
          backLabel="Back to payment history"
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <div className="space-y-4">
        <div className="receipt-no-print">
          <Link
            href="/portal/payments"
            className="text-sm text-[#0f2744] hover:underline"
          >
            ← Payment history
          </Link>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-[#0f2744]">
                {receipt?.documentTitle ?? "Payment receipt"}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Download or print this receipt for your records.
              </p>
            </div>
            {receipt ? (
              <RentPaymentReceiptActions
                receipt={receipt}
                secondaryButtonClassName={portalSecondaryButtonClassName}
                primaryButtonClassName={portalPrimaryButtonClassName}
              />
            ) : null}
          </div>
        </div>

        {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

        {receipt ? (
          <RentPaymentReceiptView
            receipt={receipt}
            issuedToLabel="Tenant copy"
          />
        ) : null}
      </div>
    </PortalShell>
  );
}
