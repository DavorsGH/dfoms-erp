import { redirect } from "next/navigation";
import {
  fetchPortalDashboardData,
  getPortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import PortalSignOutButton from "./sign-out-button";
import PayRentButton from "./pay-rent-button";
import RequestEarlyTerminationButton from "./request-early-termination-button";

function formatMoney(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

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

export default async function PortalDashboardPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const { data, error } = await fetchPortalDashboardData(session);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Davors Tenant Portal
            </p>
            <h1 className="text-lg font-semibold text-[#0f2744]">
              Welcome, {session.fullName}
            </h1>
          </div>
          <PortalSignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {!data ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-slate-600">
              No active lease was found for your account. Contact your property
              manager if this looks wrong.
            </p>
          </div>
        ) : (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-[#0f2744]">
                Your unit
              </h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Property
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {data.propertyName}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Unit
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {data.unitNumber}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-[#0f2744]">
                Active lease
              </h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Monthly rent
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatMoney(data.rentAmountGhs)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Status
                  </dt>
                  <dd className="mt-1 text-sm capitalize text-slate-900">
                    {data.leaseStatus}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Start date
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatDate(data.leaseStartDate)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    End date
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {formatDate(data.leaseEndDate)}
                  </dd>
                </div>
              </dl>
              <div className="mt-5">
                <RequestEarlyTerminationButton
                  alreadyPending={
                    data.terminationRequestStatus === "pending_staff_approval"
                  }
                  pendingReason={data.pendingTerminationReason}
                />
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-[#0f2744]">
                Current rent status
              </h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Status
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {data.rentStatusLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Period
                  </dt>
                  <dd className="mt-1 text-sm text-slate-900">
                    {data.rentPeriodStart && data.rentPeriodEnd
                      ? `${formatDate(data.rentPeriodStart)} – ${formatDate(data.rentPeriodEnd)}`
                      : "—"}
                  </dd>
                </div>
              </dl>

              {data.unpaidRent ? (
                <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-medium text-[#0f2744]">
                    Outstanding: {formatMoney(data.unpaidRent.outstandingGhs)}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatDate(data.unpaidRent.periodStart)} –{" "}
                    {formatDate(data.unpaidRent.periodEnd)} ·{" "}
                    {data.unpaidRent.statusLabel}
                  </p>
                  <PayRentButton
                    entryId={data.unpaidRent.entryId}
                    outstandingGhs={data.unpaidRent.outstandingGhs}
                    periodLabel={`${formatDate(data.unpaidRent.periodStart)} – ${formatDate(data.unpaidRent.periodEnd)}`}
                  />
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-600">
                  No unpaid rent on your current periods.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
