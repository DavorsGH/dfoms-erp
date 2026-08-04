import { redirect } from "next/navigation";
import Link from "next/link";
import {
  fetchPortalDashboardData,
  getPortalLesseeSession,
} from "@/utils/lessee-portal-auth";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PayRentButton from "./pay-rent-button";
import RequestEarlyTerminationButton from "./request-early-termination-button";
import LeaseSignaturePanel from "@/app/dashboard/real-estate/lease-signature-panel";
import {
  canInitiatePortalRentPayment,
  portalRentPaymentBlockedMessage,
} from "@/utils/lease-signature";

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
    <PortalShell fullName={session.fullName}>
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {!data ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">
            No active lease was found for your account. Contact your property
            manager if this looks wrong.
          </p>
        </section>
      ) : (
        <>
          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Your unit</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Active lease</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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

          <LeaseSignaturePanel
            mode="tenant"
            tenantId={session.tenantId}
            leaseId={data.leaseId}
            signatureStatus={data.signatureStatus}
            landlordAcknowledgedAt={data.landlordAcknowledgedAt}
            tenantAcknowledgedAt={data.tenantAcknowledgedAt}
            landlordName={data.landlordName}
            landlordAddress={data.landlordAddress}
            landlordPhone={data.landlordPhone}
            lesseeName={data.lesseeName}
            lesseePhone={data.lesseePhone}
            lesseeEmail={data.lesseeEmail}
            propertyName={data.propertyName}
            propertyAddress={data.propertyAddress}
            propertyLocation={data.propertyLocation}
            unitNumber={data.unitNumber}
            startDate={data.leaseStartDate}
            endDate={data.leaseEndDate}
            rentAmountGhs={data.rentAmountGhs}
            advanceRentAmountGhs={data.advanceRentAmountGhs}
            terminationNoticeMonths={data.terminationNoticeMonths}
            depositAmountGhs={data.depositAmountGhs}
            agreementDate={data.leaseCreatedAt}
            leaseDocumentUrl={data.leaseDocumentUrl}
          />

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Current rent status</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
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
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No unpaid rent on your current periods.
              </p>
            )}
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Other charges</h2>
            {data.otherCharges.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {data.otherCharges.map((charge) => (
                  <li
                    key={charge.entryId}
                    className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"
                  >
                    <p className="text-sm font-medium text-[#0f2744]">
                      {charge.description}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {formatMoney(charge.outstandingGhs)} outstanding ·{" "}
                      {formatDate(charge.periodStart)} · {charge.statusLabel}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No outstanding other charges.
              </p>
            )}
          </section>

          {data.paymentTotalGhs > 0 ? (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>Pay now</h2>
              <p className="mt-2 text-sm text-slate-600">
                {data.unpaidRent && data.otherCharges.length > 0
                  ? "Pay current rent and all outstanding other charges in one transaction."
                  : data.unpaidRent
                    ? "Pay your outstanding rent."
                    : "Pay outstanding other charges."}
              </p>
              <p className="mt-3 text-sm font-medium text-[#0f2744]">
                Total due: {formatMoney(data.paymentTotalGhs)}
              </p>
              <PayRentButton
                entryIds={data.paymentEntryIds}
                outstandingGhs={data.paymentTotalGhs}
                periodLabel={
                  data.unpaidRent
                    ? `${formatDate(data.unpaidRent.periodStart)} – ${formatDate(data.unpaidRent.periodEnd)}`
                    : "other charges"
                }
                signatureStatus={data.signatureStatus}
                paymentBlockedMessage={
                  canInitiatePortalRentPayment(data.signatureStatus)
                    ? null
                    : portalRentPaymentBlockedMessage(data.signatureStatus)
                }
              />
            </section>
          ) : null}

          <section className={portalSectionClassName}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className={portalSectionTitleClassName}>Payments & receipts</h2>
              <Link
                href="/portal/payments"
                className="text-sm font-medium text-[#0f2744] hover:underline"
              >
                View payment history
              </Link>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Download or print receipts for confirmed rent and one-time charge
              payments.
            </p>
            {data.depositId ? (
              <p className="mt-3 text-sm text-slate-600">
                Security deposit:{" "}
                <Link
                  href={`/portal/deposits/${data.depositId}`}
                  className="font-medium text-[#0f2744] hover:underline"
                >
                  View deposit records
                </Link>
              </p>
            ) : null}
          </section>
        </>
      )}
    </PortalShell>
  );
}
