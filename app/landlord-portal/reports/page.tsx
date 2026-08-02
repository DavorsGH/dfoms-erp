import { redirect } from "next/navigation";
import {
  fetchLandlordPortalReports,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalReportExportActions from "./report-export-actions";

export default async function LandlordPortalReportsPage() {
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

  const { data, error } = await fetchLandlordPortalReports(session);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={portalSectionTitleClassName}>Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Portfolio rollups from units, leases, rent ledger, and expenses.
            Export CSV (Excel-compatible) or print to PDF.
          </p>
        </div>
        {data ? (
          <LandlordPortalReportExportActions
            occupancyRows={data.exportRows.occupancy}
            arrearsRows={data.exportRows.arrears}
            ytdRows={data.exportRows.ytd}
          />
        ) : null}
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {!data ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No report data available yet.</p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <section className={portalSectionClassName}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Occupancy rate
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
                {data.occupancyRatePct}%
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.occupiedUnits} of {data.totalUnits} units occupied (
                {data.vacantUnits} vacant)
              </p>
            </section>
            <section className={portalSectionClassName}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Rent collected
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
                {formatPayoutMoney(data.rentCollectedGhs)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Sum of amount paid on rent ledger
              </p>
            </section>
            <section className={portalSectionClassName}>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Outstanding
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
                {formatPayoutMoney(data.rentOutstandingGhs)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Open balance across ledger periods
              </p>
            </section>
          </div>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Arrears aging</h2>
            <p className="mt-1 text-sm text-slate-600">
              Outstanding amounts aged from each period end date.
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Current
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.arrearsBuckets.current)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  1–30 days
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.arrearsBuckets.days1to30)}
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
                  61+ days
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.arrearsBuckets.days61Plus)}
                </dd>
              </div>
            </dl>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>
              Year-to-date summary ({data.ytd.year})
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Collected vs due, expenses, and net income from 1 Jan through
              today.
            </p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Rent collected YTD
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.ytd.rentCollectedGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Rent due YTD
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.ytd.rentDueGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Expenses YTD
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.ytd.expensesGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Net income YTD
                </dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">
                  {formatPayoutMoney(data.ytd.netIncomeGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Outstanding (YTD periods)
                </dt>
                <dd className="mt-1 text-sm font-medium text-slate-900">
                  {formatPayoutMoney(data.ytd.outstandingGhs)}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
