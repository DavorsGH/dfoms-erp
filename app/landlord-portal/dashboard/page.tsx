import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalOverviewMetrics,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import { formatLeaseDate } from "@/app/dashboard/real-estate/leases-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalRentCollectionChart from "./rent-collection-chart";

function MetricCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <div className={portalSectionClassName}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );

  if (!href) {
    return body;
  }

  return (
    <Link href={href} className="block transition-opacity hover:opacity-90">
      {body}
    </Link>
  );
}

function formatActivityDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default async function LandlordPortalDashboardPage() {
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

  const { data, error } = await fetchLandlordPortalOverviewMetrics(session);
  const isDavorsManaged = session.landlordType === "davors_managed";
  const isPlatformOnly = session.landlordType === "platform_only";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[#0f2744]">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Portfolio overview for {session.fullName}
          {isDavorsManaged
            ? " · Davors managed (view-only finance remittance)"
            : isPlatformOnly
              ? " · Platform only (self-manage)"
              : null}
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {!data ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">
            No property data was found for your account yet.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Occupancy"
              value={`${data.occupancyRatePct}% occupied`}
              hint={`${data.vacantUnits} vacant · ${data.occupiedUnits}/${data.totalUnits} units`}
              href="/landlord-portal/real-estate/units"
            />
            <MetricCard
              label="Rent collected this month"
              value={formatPayoutMoney(data.rentCollectedThisMonthGhs)}
              href="/landlord-portal/finance/rent-ledger"
            />
            <MetricCard
              label="Outstanding balance"
              value={formatPayoutMoney(data.outstandingBalanceGhs)}
              href="/landlord-portal/finance/rent-ledger"
            />
            <MetricCard
              label="Net income this month"
              value={formatPayoutMoney(data.netIncomeThisMonthGhs)}
              hint={`Collected ${formatPayoutMoney(data.rentCollectedThisMonthGhs)} − expenses ${formatPayoutMoney(data.expensesThisMonthGhs)}`}
              href={
                isPlatformOnly
                  ? "/landlord-portal/finance/expenses"
                  : "/landlord-portal/finance/rent-ledger"
              }
            />
            <MetricCard
              label="Open maintenance"
              value={String(data.openMaintenanceCount)}
              href="/landlord-portal/maintenance"
            />
            <MetricCard
              label="Open complaints"
              value={String(data.openComplaintsCount)}
              href="/landlord-portal/complaints"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>Arrears aging</h2>
              <p className="mt-1 text-sm text-slate-600">
                Overdue balances aged from each ledger period end.
              </p>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    0–30 days
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {formatPayoutMoney(data.arrearsBuckets.days0to30)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    31–60 days
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {formatPayoutMoney(data.arrearsBuckets.days31to60)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    60+ days
                  </dt>
                  <dd className="mt-1 text-sm font-medium text-slate-900">
                    {formatPayoutMoney(data.arrearsBuckets.days61Plus)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>
                Upcoming lease expirations
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Active leases ending in the next 30 / 60 / 90 days.
              </p>
              {data.upcomingLeaseExpirations.length === 0 ? (
                <p className="mt-4 text-sm text-slate-600">
                  No leases ending in the next 90 days.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-slate-200">
                  {data.upcomingLeaseExpirations.map((lease) => (
                    <li key={lease.leaseId} className="py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">
                          {lease.lesseeName}
                        </p>
                        <p className="text-xs text-slate-500">
                          {lease.daysUntilEnd <= 30
                            ? "≤30 days"
                            : lease.daysUntilEnd <= 60
                              ? "≤60 days"
                              : "≤90 days"}
                        </p>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {lease.unitLabel} · ends{" "}
                        {formatLeaseDate(lease.endDate)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>
              Rent collection trend
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Last 6 months — amount due by period vs cash collected by payment
              date.
            </p>
            <div className="mt-4">
              <LandlordPortalRentCollectionChart
                data={data.rentCollectionTrend}
              />
            </div>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Recent activity</h2>
            <p className="mt-1 text-sm text-slate-600">
              Latest payments, maintenance, complaints, and expenses across
              your portfolio.
            </p>
            {data.recentActivity.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No recent activity.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {data.recentActivity.map((item) => (
                  <li key={item.id} className="py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatActivityDate(item.occurredAt)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{item.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Quick links</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          <li>
            <Link
              href="/landlord-portal/real-estate/properties"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[#0f2744] hover:bg-slate-50"
            >
              Properties
            </Link>
          </li>
          <li>
            <Link
              href="/landlord-portal/finance/rent-ledger"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[#0f2744] hover:bg-slate-50"
            >
              Rent ledger
            </Link>
          </li>
          <li>
            <Link
              href="/landlord-portal/reports"
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[#0f2744] hover:bg-slate-50"
            >
              Reports
            </Link>
          </li>
          {isDavorsManaged ? (
            <li>
              <Link
                href="/landlord-portal/finance/payouts"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[#0f2744] hover:bg-slate-50"
              >
                Payouts &amp; escrow
              </Link>
            </li>
          ) : null}
          {isPlatformOnly ? (
            <li>
              <Link
                href="/landlord-portal/administration/notification-contacts"
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[#0f2744] hover:bg-slate-50"
              >
                Notification contacts
              </Link>
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
