import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import RentPaymentReceiptActions from "@/app/dashboard/real-estate/rent-payment-receipt-actions";
import RentPaymentReceiptView from "@/app/dashboard/real-estate/rent-payment-receipt-view";
import { fetchRentPaymentReceipt } from "@/utils/rent-payment-receipt";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  portalErrorBannerClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";

type PageProps = {
  params: Promise<{ entryId: string }>;
};

export default async function LandlordPortalPaymentReceiptPage({
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

  const { entryId } = await params;
  const admin = createAdminClient();
  const { receipt, error } = await fetchRentPaymentReceipt(admin, {
    tenantId: session.tenantId,
    entryId,
  });

  if (!receipt && !error) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/finance/rent-ledger"
        backLabel="Back to rent ledger"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link
          href="/landlord-portal/finance/rent-ledger"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Rent ledger
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#0f2744]">
              Payment receipt
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {receipt?.documentTitle ?? "Payment receipt"} (read-only).
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

      {error ? (
        <div className={`print:hidden ${portalErrorBannerClassName}`}>{error}</div>
      ) : null}

      {receipt ? (
        <RentPaymentReceiptView
          receipt={receipt}
          issuedToLabel={`Landlord: ${session.fullName}`}
        />
      ) : null}
    </div>
  );
}
