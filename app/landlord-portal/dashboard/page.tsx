import { redirect } from "next/navigation";
import {
  fetchLandlordPortalDashboardData,
  fetchLandlordPortalNotificationContacts,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatLeaseMoney } from "@/app/dashboard/real-estate/leases-utils";
import { formatPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalShell from "../portal-shell";
import LandlordPortalNotificationContactsForm from "./notification-contacts-form";

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

  const { data, error } = await fetchLandlordPortalDashboardData(session);
  const isDavorsManaged = session.landlordType === "davors_managed";
  const isPlatformOnly = session.landlordType === "platform_only";
  const contacts = isPlatformOnly
    ? await fetchLandlordPortalNotificationContacts(session)
    : null;

  return (
    <LandlordPortalShell fullName={session.fullName}>
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Management type
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {isDavorsManaged
                ? "Davors managed"
                : isPlatformOnly
                  ? "Platform only"
                  : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Access
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {isPlatformOnly
                ? "Self-manage (approve / respond)"
                : "View only"}
            </dd>
          </div>
        </dl>
        {isPlatformOnly ? (
          <p className="mt-4 text-sm text-slate-600">
            Rent is collected directly to your account. Escrow and payout history
            are not used for platform-only landlords. You can approve maintenance,
            respond to complaints, and decide termination requests yourself.
          </p>
        ) : null}
      </section>

      {isPlatformOnly ? (
        <section className={portalSectionClassName}>
          <h2 className={portalSectionTitleClassName}>
            Notification contacts
          </h2>
          {contacts?.error ? (
            <div className={`mt-4 ${portalErrorBannerClassName}`}>
              {contacts.error}
            </div>
          ) : (
            <LandlordPortalNotificationContactsForm
              initialPhone={contacts?.notificationPhone ?? null}
              initialEmail={contacts?.notificationEmail ?? null}
            />
          )}
        </section>
      ) : null}

      {!data ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">
            No property data was found for your account yet.
          </p>
        </section>
      ) : (
        <>
          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Properties</h2>
            {data.properties.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No properties yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {data.properties.map((property) => (
                  <li key={property.propertyId} className="py-3">
                    <p className="text-sm font-medium text-slate-900">
                      {property.name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {property.city ? `${property.city} · ` : null}
                      {property.unitCount} unit
                      {property.unitCount === 1 ? "" : "s"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Tenants &amp; leases</h2>
            {data.leases.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">No leases yet.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {data.leases.map((lease) => (
                  <li key={lease.leaseId} className="py-3">
                    <p className="text-sm font-medium text-slate-900">
                      {lease.lesseeName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {lease.propertyName} · Unit {lease.unitNumber} ·{" "}
                      {formatLeaseMoney(lease.rentAmountGhs)} ·{" "}
                      <span className="capitalize">{lease.status}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>
              {isPlatformOnly
                ? "Your rent collection"
                : "Rent collection status"}
            </h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Recent paid
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {data.rent.paidCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Outstanding periods
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {data.rent.unpaidCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Outstanding amount
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatPayoutMoney(data.rent.outstandingGhs)}
                </dd>
              </div>
            </dl>

            {data.rent.recent.length === 0 ? (
              <p className="mt-4 text-sm text-slate-600">
                No rent ledger entries yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-200">
                {data.rent.recent.map((row) => (
                  <li key={row.entryId} className="py-3">
                    <p className="text-sm font-medium text-slate-900">
                      {row.lesseeName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.unitLabel} · {formatDate(row.periodStart)} –{" "}
                      {formatDate(row.periodEnd)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.statusLabel}
                      {row.outstandingGhs > 0
                        ? ` · ${formatPayoutMoney(row.outstandingGhs)} due`
                        : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isDavorsManaged ? (
            <>
              <section className={portalSectionClassName}>
                <h2 className={portalSectionTitleClassName}>
                  Current escrow balance
                </h2>
                <p className="mt-4 text-2xl font-semibold text-[#0f2744]">
                  {formatPayoutMoney(data.escrowBalanceGhs ?? 0)}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  Funds held by Davors before remittance.
                </p>
              </section>

              <section className={portalSectionClassName}>
                <h2 className={portalSectionTitleClassName}>Payout history</h2>
                {data.payouts.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-600">
                    No payouts recorded yet.
                  </p>
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
            </>
          ) : null}
        </>
      )}
    </LandlordPortalShell>
  );
}
