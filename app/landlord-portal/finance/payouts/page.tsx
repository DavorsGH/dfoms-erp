import { redirect } from "next/navigation";
import {
  fetchLandlordPortalDashboardData,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function LandlordPortalPayoutsPage() {
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

  if (session.landlordType !== "davors_managed") {
    redirect("/landlord-portal/finance/rent-ledger");
  }

  const { data, error } = await fetchLandlordPortalDashboardData(session);

  return (
    <div className="space-y-6">
      <div>
        <h1 className={portalSectionTitleClassName}>Payouts &amp; escrow</h1>
        <p className="mt-1 text-sm text-slate-600">
          View-only remittance history and funds held by Davors before payout.
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Current escrow balance</h2>
        <p className="mt-4 text-2xl font-semibold text-[#0f2744]">
          {formatPayoutMoney(data?.escrowBalanceGhs ?? 0)}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Funds held by Davors before remittance.
        </p>
      </section>

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Payout history</h2>
        {!data || data.payouts.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No payouts recorded yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {data.payouts.map((payout) => (
              <li key={payout.payoutId} className="py-3">
                <p className="text-sm font-medium text-slate-900">
                  {formatPayoutMoney(payout.netAmountGhs)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatDate(payout.periodStart)} –{" "}
                  {formatDate(payout.periodEnd)} ·{" "}
                  {payout.remittanceStatusLabel}
                  {payout.remittanceDate
                    ? ` · ${formatDate(payout.remittanceDate)}`
                    : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
