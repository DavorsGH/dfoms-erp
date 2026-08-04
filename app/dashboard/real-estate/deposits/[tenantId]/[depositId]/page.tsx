import Link from "next/link";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import SecurityDepositReceiptActions from "@/app/dashboard/real-estate/security-deposit-receipt-actions";
import {
  SecurityDepositCollectionReceiptView,
  SecurityDepositResolutionReceiptView,
} from "@/app/dashboard/real-estate/security-deposit-receipt-view";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchSecurityDepositReceipt, depositIsResolved } from "@/utils/security-deposit-receipt";

type PageProps = {
  params: Promise<{ tenantId: string; depositId: string }>;
};

const primaryButtonClassName =
  "inline-flex items-center justify-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default async function StaffSecurityDepositReceiptPage({
  params,
}: PageProps) {
  const { tenantId, depositId } = await params;
  const admin = createAdminClient();
  const { receipt, error } = await fetchSecurityDepositReceipt(admin, {
    tenantId,
    depositId,
  });

  if (!receipt && !error) {
    return (
      <NotificationTargetUnavailablePanel
        backHref={`/dashboard/real-estate/leases/${tenantId}`}
        backLabel="Back to leases"
      />
    );
  }

  const showResolution = receipt ? depositIsResolved(receipt.status) : false;

  return (
    <div className="space-y-4">
      <div className="receipt-no-print">
        <Link
          href={`/dashboard/real-estate/leases/${tenantId}/${receipt?.leaseId ?? ""}`}
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Back to lease
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
          Security deposit records
        </h1>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {receipt ? (
        <>
          <div className="receipt-no-print flex flex-wrap gap-2">
            <SecurityDepositReceiptActions
              receipt={receipt}
              kind="collection"
              secondaryButtonClassName={secondaryButtonClassName}
              primaryButtonClassName={primaryButtonClassName}
            />
            {showResolution ? (
              <SecurityDepositReceiptActions
                receipt={receipt}
                kind="resolution"
                secondaryButtonClassName={secondaryButtonClassName}
                primaryButtonClassName={primaryButtonClassName}
              />
            ) : null}
          </div>

          <SecurityDepositCollectionReceiptView receipt={receipt} />

          {showResolution ? (
            <SecurityDepositResolutionReceiptView receipt={receipt} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
